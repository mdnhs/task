import { and, eq, notInArray, sql } from "drizzle-orm"
import { AppError, Conflict } from "../../core/errors"
import { moduleOverrides, subscriptions, tenants } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { entitlementsData, invalidateEntitlements } from "../entitlements"
import { recordPlatformAudit } from "../platform-audit"
import { getTenantMeta } from "./tenants"

const DAY_MS = 86_400_000
// Two-key advisory lock namespace for tenant lifecycle writes ("life"): distinct from sett/rbac/intg/dsr/team/dev/seat/PLAT.
const LIFE_LOCK_NS = 0x6c696665
const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")

/** `reason` is required: a non-empty string (after trim) of at most 500 characters, else 422 invalid_reason. */
export function assertReason(reason: unknown): string {
  if (typeof reason !== "string" || !reason.trim() || reason.length > 500) throw unprocessable("invalid_reason")
  return reason
}

type Staff = { userId: string }

/**
 * One transaction per lifecycle action. Order (ruling 3): domain lock, the change, the TENANT audit row (actor platform:<staffId>),
 * then the PLATFORM audit row (its lock is taken last). The entitlement cache is dropped after commit.
 */
async function lifecycle<T, P>(deps: Deps, tenantId: string, staff: Staff, prepare: () => P, fn: (tx: TenantTx, id: string, now: Date, actorId: string, p: P) => Promise<T>): Promise<T> {
  const meta = await getTenantMeta(deps.db, tenantId) // 404 tenant_not_found FIRST, before any input validation (422)
  const prepared = prepare()
  const now = deps.clock.now()
  const result = await withTenant(deps.db, meta.id, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LIFE_LOCK_NS}::int4, hashtext(${meta.id}::text))`)
    return fn(tx, meta.id, now, `platform:${staff.userId}`, prepared)
  })
  invalidateEntitlements(meta.id)
  return result
}

async function audit(tx: TenantTx, id: string, staff: Staff, actorId: string, now: Date, a: { tenantAction: string; platformAction: string; before: unknown; after: unknown }) {
  await recordAudit(tx, id, { action: a.tenantAction, entity: "tenant", entityId: id, actorId, before: a.before, after: a.after }, now)
  await recordPlatformAudit(tx, { action: a.platformAction, entity: "tenant", entityId: id, actorId: staff.userId, targetTenantId: id, before: a.before, after: a.after }, now)
}

async function setStatus(deps: Deps, tenantId: string, staff: Staff, reasonIn: unknown, from: "active" | "suspended", to: "active" | "suspended", conflict: string) {
  return lifecycle(deps, tenantId, staff, () => assertReason(reasonIn), async (tx, id, now, actorId, reason) => {
    const [row] = await tx.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, id)).for("update")
    if (row.status !== from) throw Conflict(conflict)
    await tx.update(tenants).set({ status: to }).where(eq(tenants.id, id))
    await audit(tx, id, staff, actorId, now, {
      tenantAction: to === "suspended" ? "tenant.suspended" : "tenant.reactivated", platformAction: to === "suspended" ? "platform.tenant.suspended" : "platform.tenant.reactivated",
      before: { status: from }, after: { status: to, reason },
    })
    return { status: to }
  })
}

/** Suspends a tenant (requireTenant then answers 404 for its members). Data is kept. 409 already_suspended. */
export const suspendTenant = (deps: Deps, tenantId: string, staff: Staff, reason: unknown) => setStatus(deps, tenantId, staff, reason, "active", "suspended", "already_suspended")
/** 409 not_suspended when the tenant is active. */
export const reactivateTenant = (deps: Deps, tenantId: string, staff: Staff, reason: unknown) => setStatus(deps, tenantId, staff, reason, "suspended", "active", "not_suspended")

/** Extends a running trial: new trial_end = max(now, trial_end) + days (1..30). 422 not_trialing for any other status. */
export async function extendTrial(deps: Deps, tenantId: string, staff: Staff, input: { days?: unknown; reason?: unknown }): Promise<{ trialEndsAt: Date }> {
  const prepare = () => {
    const reason = assertReason(input.reason)
    const days = input.days
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 30) throw unprocessable("invalid_days")
    return { reason, days }
  }
  return lifecycle(deps, tenantId, staff, prepare, async (tx, id, now, actorId, { reason, days }) => {
    const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, id)).for("update")
    if (!sub) throw new AppError(404, "subscription_not_found", "Not Found")
    if (sub.status !== "trialing") throw unprocessable("not_trialing")
    const base = sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now
    const trialEndsAt = new Date(base.getTime() + days * DAY_MS)
    await tx.update(subscriptions).set({ trialEndsAt }).where(eq(subscriptions.tenantId, id))
    await audit(tx, id, staff, actorId, now, {
      tenantAction: "tenant.trial_extended", platformAction: "platform.tenant.trial_extended",
      before: { trialEndsAt: sub.trialEndsAt }, after: { trialEndsAt, days, reason },
    })
    return { trialEndsAt }
  })
}

export type OverrideInput = { module: string; mode: "grant" | "revoke" }

/**
 * Replaces the tenant's module overrides with exactly `overrides` (modules not listed go back to what the plan says). Unknown
 * module 422, revoking a core module 422 core_module, duplicates 422. Removing a module never deletes its data.
 */
export async function setTenantModules(deps: Deps, tenantId: string, staff: Staff, input: { overrides: OverrideInput[]; reason?: unknown }): Promise<{ overrides: OverrideInput[] }> {
  const prepare = () => {
    const reason = assertReason(input.reason)
    const data = entitlementsData()
    const seen = new Set<string>()
    for (const o of input.overrides) {
      if (!data.productModules.some((p) => p.id === o.module)) throw unprocessable("unknown_module")
      if (o.mode === "revoke" && data.core?.includes(o.module)) throw unprocessable("core_module")
      if (seen.has(o.module)) throw unprocessable("duplicate_module")
      seen.add(o.module)
    }
    return reason
  }
  return lifecycle(deps, tenantId, staff, prepare, async (tx, id, now, actorId, reason) => {
    const existing = await tx.select({ module: moduleOverrides.module, mode: moduleOverrides.mode }).from(moduleOverrides).where(eq(moduleOverrides.tenantId, id)).for("update")
    const byModule = new Map(existing.map((e) => [e.module, e.mode]))
    const keep = input.overrides.map((o) => o.module)
    if (keep.length) await tx.delete(moduleOverrides).where(and(eq(moduleOverrides.tenantId, id), notInArray(moduleOverrides.module, keep)))
    else await tx.delete(moduleOverrides).where(eq(moduleOverrides.tenantId, id))
    for (const o of input.overrides) {
      if (byModule.get(o.module) === o.mode) continue // unchanged: keep its original reason and setter
      await tx.insert(moduleOverrides).values({ tenantId: id, module: o.module, mode: o.mode, reason, setBy: staff.userId, setAt: now })
        .onConflictDoUpdate({ target: [moduleOverrides.tenantId, moduleOverrides.module], set: { mode: o.mode, reason, setBy: staff.userId, setAt: now } })
    }
    const sorted = (xs: OverrideInput[]) => [...xs].sort((a, b) => a.module.localeCompare(b.module)).map((x) => ({ module: x.module, mode: x.mode }))
    const after = sorted(input.overrides)
    await audit(tx, id, staff, actorId, now, {
      tenantAction: "tenant.modules_updated", platformAction: "platform.tenant.modules_updated",
      before: { overrides: sorted(existing) }, after: { overrides: after, reason },
    })
    return { overrides: after }
  })
}
