import { and, count, eq, sql } from "drizzle-orm"
import { resolveEntitlements, type ModuleOverride, type TenantEntitlements } from "@opsdesk/domain/entitlements"
import type { Db, Deps } from "../../deps"
import { AppError, Conflict } from "../../core/errors"
import { publish } from "../../core/events"
import { memberships, moduleOverrides, plans, subscriptions, type SubscriptionStatus } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import { entitlementsData } from "./data"

export type { SubscriptionStatus }

const DAY_MS = 86_400_000
/** Writes stay allowed this long after a trial ends (ruling, T3.2), then every non-GET tenant route answers 402 billing_required. */
export const GRACE_DAYS = 7
/** An entitlement change must reach the API within one minute (FR-M0-15, AC-M0-05). */
export const ENTITLEMENT_TTL_MS = 60_000

// Two-key advisory lock namespace for seat accounting ("seat"): a NEW namespace, distinct from sett/rbac/intg/dsr/team/dev/PLAT.
const SEAT_LOCK_NS = 0x73656174

/** "ok" = normal, "grace" = trial over but writes still allowed, "blocked" = non-GET tenant routes answer 402. */
export type BillingState = "ok" | "grace" | "blocked"
export type Entitlement = TenantEntitlements & {
  seats: number
  status: SubscriptionStatus
  trialEndsAt: Date | null
  graceEndsAt: Date | null
  billingState: BillingState
}

type Raw = { planId: string; status: SubscriptionStatus; seats: number; trialEndsAt: Date | null; overrides: ModuleOverride[] }

async function loadRaw(tx: TenantTx, tenantId: string): Promise<Raw> {
  const [row] = await tx
    .select({ planId: subscriptions.planId, status: subscriptions.status, seats: subscriptions.seats, trialEndsAt: subscriptions.trialEndsAt, limits: plans.limits })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.tenantId, tenantId))
  const overrides = await tx
    .select({ module: moduleOverrides.module, mode: moduleOverrides.mode })
    .from(moduleOverrides)
    .where(eq(moduleOverrides.tenantId, tenantId))
  // No subscription row: fail closed (default plan, never paid), not "everything".
  if (!row) return { planId: entitlementsData().defaultPlan, status: "incomplete", seats: 0, trialEndsAt: null, overrides }
  // Trial seats follow the plan's activeUsers limit.
  const seats = row.status === "trialing" ? (row.limits.activeUsers ?? row.seats) : row.seats
  return { planId: row.planId, status: row.status, seats, trialEndsAt: row.trialEndsAt, overrides }
}

function derive(raw: Raw, now: Date): Entitlement {
  const ent = resolveEntitlements(entitlementsData(), raw.planId, raw.overrides)
  const graceEndsAt = raw.trialEndsAt ? new Date(raw.trialEndsAt.getTime() + GRACE_DAYS * DAY_MS) : null
  let billingState: BillingState = "ok"
  // canceled / incomplete / unpaid / paused: blocked (a past_due subscription stays open: writes continue during dunning).
  if (raw.status === "canceled" || raw.status === "incomplete" || raw.status === "unpaid" || raw.status === "paused") billingState = "blocked"
  else if (raw.status === "trialing") {
    if (!raw.trialEndsAt || now >= raw.trialEndsAt) billingState = graceEndsAt && now < graceEndsAt ? "grace" : "blocked"
  }
  return { ...ent, seats: raw.seats, status: raw.status, trialEndsAt: raw.trialEndsAt, graceEndsAt, billingState }
}

/** A tenant's effective entitlements as of `now` (uncached; the request path uses entitlementsFor). */
export async function tenantEntitlements(db: Db, tenantId: string, now: Date): Promise<Entitlement> {
  return derive(await withTenant(db, tenantId, (tx) => loadRaw(tx, tenantId)), now)
}

// Per-tenant cache of the RAW state (time-dependent fields are derived at read time). In-process: invalidateEntitlements on any
// change here; other processes converge within the TTL.
const cache = new Map<string, { at: number; raw: Raw }>()
// Per-tenant generation, bumped by every invalidate. A load that started before an invalidate must not write its (possibly
// stale) result back into the cache, so entitlementsFor only caches when the generation is unchanged (T3.2 review, minor 1).
const generation = new Map<string, number>()

export function invalidateEntitlements(tenantId: string): void {
  generation.set(tenantId, (generation.get(tenantId) ?? 0) + 1)
  cache.delete(tenantId)
}

/** Cached (<= 60 s on deps.clock) entitlements for the request path. */
export async function entitlementsFor(deps: Deps, tenantId: string): Promise<Entitlement> {
  const now = deps.clock.now()
  const hit = cache.get(tenantId)
  if (hit && now.getTime() >= hit.at && now.getTime() - hit.at < ENTITLEMENT_TTL_MS) return derive(hit.raw, now)
  const gen = generation.get(tenantId) ?? 0
  const raw = await withTenant(deps.db, tenantId, (tx) => loadRaw(tx, tenantId))
  if ((generation.get(tenantId) ?? 0) === gen) cache.set(tenantId, { at: now.getTime(), raw })
  return derive(raw, now)
}

/** Takes the per-tenant seat advisory lock (released at commit). Take it BEFORE counting seats or writing the cap. */
export async function lockSeats(tx: TenantTx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${SEAT_LOCK_NS}::int4, hashtext(${tenantId}::text))`)
}

export async function seatsUsed(tx: TenantTx, tenantId: string): Promise<number> {
  const [r] = await tx.select({ n: count() }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active")))
  return r.n
}

/**
 * Takes the per-tenant seat lock, then throws 409 seat_limit when no seat is free. Call BEFORE the membership insert, inside the
 * same tx, so concurrent joins are serialised and cannot both take the last seat. Reads the subscription fresh (never the cache).
 */
export async function assertSeatAvailable(tx: TenantTx, tenantId: string): Promise<void> {
  await lockSeats(tx, tenantId)
  const raw = await loadRaw(tx, tenantId)
  if ((await seatsUsed(tx, tenantId)) >= raw.seats) throw Conflict("seat_limit")
}

export type SubscriptionPatch = Partial<{
  planId: string; status: SubscriptionStatus; seats: number; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean
  provider: string | null; providerCustomerId: string | null; providerSubscriptionId: string | null; checkoutSessionId: string | null; updatedFromEventAt: Date | null
}>
type SubscriptionRow = typeof subscriptions.$inferSelect
const snap = (s: { planId: string; status: string; seats: number; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean }) => ({
  planId: s.planId, status: s.status, seats: s.seats, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd,
})

/**
 * Transaction-scoped core of changeSubscription (the provider webhook applies an event and records it in ONE tx). `patch` may
 * be a function of the locked "before" row; returning null skips the change (nothing audited or published). The caller
 * MUST call invalidateEntitlements(tenantId) AFTER the tx commits. Returns whether a change was written.
 */
export async function changeSubscriptionTx(
  tx: TenantTx, tenantId: string, actorId: string, patch: SubscriptionPatch | ((before: SubscriptionRow) => SubscriptionPatch | null), now: Date,
): Promise<boolean> {
  const [before] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).for("update")
  if (!before) throw new AppError(404, "subscription_not_found", "Not Found")
  const p = typeof patch === "function" ? patch(before) : patch
  if (!p) return false
  if (p.planId !== undefined && !(await tx.select({ id: plans.id }).from(plans).where(eq(plans.id, p.planId))).length) {
    throw new AppError(422, "unknown_plan", "Unprocessable Entity")
  }
  const [after] = await tx.update(subscriptions).set(p).where(eq(subscriptions.tenantId, tenantId)).returning()
  await recordAudit(tx, tenantId, { action: "subscription.changed", entity: "subscription", entityId: tenantId, actorId, before: snap(before), after: snap(after) }, now)
  if (before.planId !== after.planId || before.status !== after.status) {
    await publish(
      tx,
      { tenantId, type: "billing.subscription_changed", payload: { from: { planId: before.planId, status: before.status }, to: { planId: after.planId, status: after.status } }, actorId },
      now,
    )
  }
  return true
}

/**
 * Changes a tenant's subscription (platform console / provider webhooks call this). Audited with before/after in the same tx;
 * `billing.subscription_changed` is published (last) when the plan or status changed; the entitlement cache is dropped after commit.
 */
export async function changeSubscription(deps: Deps, tenantId: string, actorId: string, patch: SubscriptionPatch): Promise<void> {
  const now = deps.clock.now()
  await withTenant(deps.db, tenantId, (tx) => changeSubscriptionTx(tx, tenantId, actorId, patch, now))
  invalidateEntitlements(tenantId)
}

/** Grants or revokes a product module for one tenant on top of its plan. Core modules cannot be revoked (422 core_module). */
export async function setModuleOverride(deps: Deps, tenantId: string, actorId: string, o: { module: string; mode: "grant" | "revoke"; reason: string }): Promise<void> {
  const data = entitlementsData()
  if (!data.productModules.some((p) => p.id === o.module)) throw new AppError(422, "unknown_module", "Unprocessable Entity")
  if (o.mode === "revoke" && data.core?.includes(o.module)) throw new AppError(422, "core_module", "Unprocessable Entity")
  const now = deps.clock.now()
  await withTenant(deps.db, tenantId, async (tx) => {
    const [before] = await tx.select().from(moduleOverrides).where(and(eq(moduleOverrides.tenantId, tenantId), eq(moduleOverrides.module, o.module))).for("update")
    await tx
      .insert(moduleOverrides)
      .values({ tenantId, module: o.module, mode: o.mode, reason: o.reason, setBy: actorId, setAt: now })
      .onConflictDoUpdate({ target: [moduleOverrides.tenantId, moduleOverrides.module], set: { mode: o.mode, reason: o.reason, setBy: actorId, setAt: now } })
    await recordAudit(
      tx, tenantId,
      { action: "module_override.set", entity: "module_override", entityId: o.module, actorId, before: before ? { mode: before.mode, reason: before.reason } : null, after: { mode: o.mode, reason: o.reason } },
      now,
    )
  })
  invalidateEntitlements(tenantId)
}

/** Removes a module override (back to what the plan says). */
export async function clearModuleOverride(deps: Deps, tenantId: string, actorId: string, module: string): Promise<void> {
  const now = deps.clock.now()
  await withTenant(deps.db, tenantId, async (tx) => {
    const [before] = await tx.delete(moduleOverrides).where(and(eq(moduleOverrides.tenantId, tenantId), eq(moduleOverrides.module, module))).returning()
    if (!before) throw new AppError(404, "override_not_found", "Not Found")
    await recordAudit(tx, tenantId, { action: "module_override.cleared", entity: "module_override", entityId: module, actorId, before: { mode: before.mode, reason: before.reason }, after: null }, now)
  })
  invalidateEntitlements(tenantId)
}
