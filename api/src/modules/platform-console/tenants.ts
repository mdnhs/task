import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, max, not, like, or, sql, type SQL } from "drizzle-orm"
import { AppError, NotFound } from "../../core/errors"
import { auditEvents, dataRequests, files, memberships, moduleOverrides, plans, subscriptions, tenants } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import type { Db } from "../../deps"
import { monthlyEquivalentMinor } from "./metrics"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const TenantNotFound = () => NotFound("tenant_not_found")

export type TenantMeta = { id: string; slug: string; name: string; status: string; timezone: string; currency: string; locale: string; createdAt: Date }
const META = { id: tenants.id, slug: tenants.slug, name: tenants.name, status: tenants.status, timezone: tenants.timezone, currency: tenants.currency, locale: tenants.locale, createdAt: tenants.createdAt }

/** The tenant's platform-level row (no RLS). 404 tenant_not_found for an unknown id or anything that is not a uuid. */
export async function getTenantMeta(db: Db, tenantId: string): Promise<TenantMeta> {
  if (!UUID.test(tenantId)) throw TenantNotFound()
  const [row] = await db.select(META).from(tenants).where(eq(tenants.id, tenantId.toLowerCase()))
  if (!row) throw TenantNotFound()
  return row
}

/**
 * Cross-tenant reads (ruling 2): RLS is never bypassed. Platform-level tables are read directly; every tenant-RLS table is read
 * one tenant at a time under withTenant(), selecting only aggregates or allowed columns. This is O(tenants) round trips, accepted
 * for Phase 1. SCALE LIMIT: past a few thousand tenants move these aggregates into a platform-level rollup table maintained
 * by the writers (or a nightly job); do not widen RLS.
 */
export async function eachTenant<T>(db: Db, ids: string[], fn: (tx: Parameters<Parameters<typeof withTenant>[2]>[0], tenantId: string) => Promise<T>): Promise<{ tenantId: string; value: T }[]> {
  const out: { tenantId: string; value: T }[] = []
  for (const id of ids) out.push({ tenantId: id, value: await withTenant(db, id, (tx) => fn(tx, id)) })
  return out
}

const DAY_MS = 86_400_000
/** A trial that ends within this many days is a reason to call (amber). */
export const HEALTH_TRIAL_DAYS = 7
/** A workspace with no activity for more than this many days is amber. */
export const HEALTH_IDLE_DAYS = 30
export type Health = "green" | "amber" | "red"

/**
 * The health light of a tenant, from what the platform already holds (no tenant business data). Rules, first match wins:
 *  - RED   the tenant is `suspended`, or the payment state is bad: the subscription is `past_due` or `unpaid`;
 *  - AMBER a trial ends within 7 days or its end has passed while the status is still `trialing` (a trial that was never converted), or there was no activity for more than 30 days
 *          (activity = the newest member activity or tenant audit event; a tenant that never had any counts from its creation day, so a new tenant is not amber on day one);
 *  - GREEN everything else (no subscription, canceled, active and recently used).
 * There is no per-tenant error-rate metric in the platform today, so no error-rate rule and no threshold setting exists yet; when one does, it is a third input here.
 */
export function healthOf(i: { status: string | null; tenantStatus?: string | null; trialEndsAt: Date | null; lastActivityAt: Date | null; createdAt: Date }, now: Date): Health {
  if (i.tenantStatus === "suspended" || i.status === "past_due" || i.status === "unpaid") return "red"
  if (i.status === "trialing" && i.trialEndsAt && i.trialEndsAt.getTime() - now.getTime() <= HEALTH_TRIAL_DAYS * DAY_MS) return "amber" // ends within 7 days, or is already over while still `trialing` (nobody converted it)
  const since = i.lastActivityAt ?? i.createdAt
  if (now.getTime() - since.getTime() > HEALTH_IDLE_DAYS * DAY_MS) return "amber"
  return "green"
}

export type TenantUsage = { seats: number; activeUsers30d: number; storageBytes: number }
export type TenantFigures = { mrrCents: number; currency: string | null; health: Health; usage: TenantUsage; lastActivityAt: Date | null; sub: { planId: string; status: string; seats: number; trialEndsAt: Date | null } | null }

/**
 * The per-tenant figures of the console (MRR, health, usage), read under THAT tenant's RLS context and returned as numbers only. MRR is the FLAT plan price of an ACTIVE subscription in the plan's own
 * currency (rulings C10 and C11: seats never multiply it, past_due/trialing/canceled/unpaid are 0, the currency is never assumed; `null` without a subscription). Usage: `seats` = active members, `activeUsers30d`
 * = active members seen in the last 30 days, `storageBytes` = uploaded files whose object is still stored (deleted rows count until the object is really removed). Only counts and sums are selected.
 */
export async function tenantFigures(tx: Parameters<Parameters<typeof withTenant>[2]>[0], meta: { id: string; createdAt: Date; status?: string }, now: Date): Promise<TenantFigures> {
  const id = meta.id
  const [s] = await tx
    .select({ planId: subscriptions.planId, status: subscriptions.status, seats: subscriptions.seats, trialEndsAt: subscriptions.trialEndsAt, price: plans.priceMonthlyMinor, currency: plans.currency })
    .from(subscriptions)
    .innerJoin(plans, eq(plans.id, subscriptions.planId))
    .where(eq(subscriptions.tenantId, id))
  const since = new Date(now.getTime() - HEALTH_IDLE_DAYS * DAY_MS)
  const [m] = await tx
    .select({ seats: count(), active: sql<number>`count(*) filter (where ${memberships.lastActiveAt} >= ${since.toISOString()}::timestamptz)::int`, lastActive: max(memberships.lastActiveAt) })
    .from(memberships)
    .where(and(eq(memberships.tenantId, id), eq(memberships.status, "active")))
  const [f] = await tx.select({ bytes: sql<string>`coalesce(sum(${files.sizeBytes}), 0)::text` }).from(files).where(and(eq(files.tenantId, id), isNotNull(files.uploadedAt), isNull(files.objectRemovedAt)))
  const [a] = await tx.select({ at: max(auditEvents.at) }).from(auditEvents).where(and(eq(auditEvents.tenantId, id), or(isNull(auditEvents.actorId), not(like(auditEvents.actorId, "platform:%")))))
  const times = [m.lastActive, a?.at].filter((t): t is Date => !!t).map((t) => new Date(t).getTime())
  const lastActivityAt = times.length ? new Date(Math.max(...times)) : null
  return {
    mrrCents: s && s.status === "active" ? monthlyEquivalentMinor(s.price) : 0,
    currency: s ? s.currency.toUpperCase() : null,
    health: healthOf({ status: s?.status ?? null, tenantStatus: meta.status ?? null, trialEndsAt: s?.trialEndsAt ?? null, lastActivityAt, createdAt: meta.createdAt }, now),
    usage: { seats: m.seats, activeUsers30d: m.active, storageBytes: Number(f.bytes) },
    lastActivityAt,
    sub: s ? { planId: s.planId, status: s.status, seats: s.seats, trialEndsAt: s.trialEndsAt } : null,
  }
}

export type ListQuery = { q?: string; status?: string; plan?: string; page: number; pageSize: number }
export type TenantListItem = { id: string; slug: string; name: string; status: string; createdAt: Date; planId: string | null; subscriptionStatus: string | null; seats: number | null; mrrCents: number; currency: string | null; health: Health; usage: TenantUsage }

export const TENANT_STATUSES = ["active", "suspended"]
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

export async function listTenants(db: Db, q: ListQuery, now: Date): Promise<{ items: TenantListItem[]; page: number; pageSize: number; total: number }> {
  if (q.status !== undefined && !TENANT_STATUSES.includes(q.status)) throw new AppError(422, "invalid_status", "Unprocessable Entity")
  if (q.plan !== undefined && !(await db.select({ id: plans.id }).from(plans).where(eq(plans.id, q.plan))).length) throw new AppError(422, "invalid_plan", "Unprocessable Entity")
  const conds: SQL[] = []
  if (q.q?.trim()) {
    const like = `%${escapeLike(q.q.trim())}%`
    conds.push(or(ilike(tenants.name, like), ilike(tenants.slug, like))!)
  }
  if (q.status) conds.push(eq(tenants.status, q.status))
  const rows = await db.select(META).from(tenants).where(conds.length ? and(...conds) : undefined).orderBy(desc(tenants.createdAt), tenants.id)

  const subOf = async (ids: string[]) => {
    const subs = await eachTenant(db, ids, async (tx, id) => (await tx.select({ planId: subscriptions.planId, status: subscriptions.status, seats: subscriptions.seats }).from(subscriptions).where(eq(subscriptions.tenantId, id)))[0])
    return new Map(subs.map((s) => [s.tenantId, s.value]))
  }
  let page = rows
  let subs: Map<string, Awaited<ReturnType<typeof subOf>> extends Map<string, infer V> ? V : never>
  if (q.plan) {
    // The plan lives in a tenant-RLS table, so the filter needs every candidate's subscription.
    subs = await subOf(rows.map((r) => r.id))
    page = rows.filter((r) => subs.get(r.id)?.planId === q.plan)
  }
  const total = page.length
  page = page.slice((q.page - 1) * q.pageSize, q.page * q.pageSize)
  if (!q.plan) subs = await subOf(page.map((r) => r.id))
  // the figures of the page only (one tenant context per row, counts and sums only)
  const figures = new Map((await eachTenant(db, page.map((r) => r.id), (tx, id) => tenantFigures(tx, page.find((r) => r.id === id)!, now))).map((f) => [f.tenantId, f.value]))
  const items = page.map((r) => {
    const s = subs.get(r.id)
    const f = figures.get(r.id)!
    return { id: r.id, slug: r.slug, name: r.name, status: r.status, createdAt: r.createdAt, planId: s?.planId ?? null, subscriptionStatus: s?.status ?? null, seats: s?.seats ?? null, mrrCents: f.mrrCents, currency: f.currency, health: f.health, usage: f.usage }
  })
  return { items, page: q.page, pageSize: q.pageSize, total }
}

export type TenantDetail = {
  tenant: TenantMeta
  subscription: { planId: string; status: string; seats: number; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; hasProviderSubscription: boolean } | null
  seatsUsed: number
  memberCount: number
  moduleOverrides: { module: string; mode: "grant" | "revoke"; reason: string; setAt: Date }[]
  lastActivityDate: string | null
  openDataRequests: number
  mrrCents: number
  currency: string | null
  health: Health
  usage: TenantUsage
}

/** The 360 view: metadata plus aggregates only (counts and one date). No member, subject or business data is selected. */
export async function tenantDetail(db: Db, tenantId: string, now: Date): Promise<TenantDetail> {
  const tenant = await getTenantMeta(db, tenantId)
  const id = tenant.id
  return withTenant(db, id, async (tx) => {
    const [s] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, id))
    const [seats] = await tx.select({ n: count() }).from(memberships).where(and(eq(memberships.tenantId, id), eq(memberships.status, "active")))
    const [members] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.tenantId, id))
    const overrides = await tx.select({ module: moduleOverrides.module, mode: moduleOverrides.mode, reason: moduleOverrides.reason, setAt: moduleOverrides.setAt }).from(moduleOverrides).where(eq(moduleOverrides.tenantId, id)).orderBy(moduleOverrides.module)
    const [last] = await tx.select({ at: max(auditEvents.at) }).from(auditEvents).where(and(eq(auditEvents.tenantId, id), or(isNull(auditEvents.actorId), not(like(auditEvents.actorId, "platform:%")))))
    const [open] = await tx.select({ n: count() }).from(dataRequests).where(and(eq(dataRequests.tenantId, id), inArray(dataRequests.status, ["pending", "running"])))
    const figures = await tenantFigures(tx, tenant, now)
    return {
      tenant,
      subscription: s ? { planId: s.planId, status: s.status, seats: s.seats, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd, hasProviderSubscription: s.providerSubscriptionId !== null } : null,
      seatsUsed: seats.n, memberCount: members.n, moduleOverrides: overrides,
      lastActivityDate: last?.at ? new Date(last.at).toISOString().slice(0, 10) : null,
      openDataRequests: open.n, mrrCents: figures.mrrCents, currency: figures.currency, health: figures.health, usage: figures.usage,
    }
  })
}
