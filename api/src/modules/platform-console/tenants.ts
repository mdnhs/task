import { and, count, desc, eq, ilike, inArray, isNull, max, not, like, or, type SQL } from "drizzle-orm"
import { AppError, NotFound } from "../../core/errors"
import { auditEvents, dataRequests, memberships, moduleOverrides, plans, subscriptions, tenants } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import type { Db } from "../../deps"

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

export type ListQuery = { q?: string; status?: string; plan?: string; page: number; pageSize: number }
export type TenantListItem = { id: string; slug: string; name: string; status: string; createdAt: Date; planId: string | null; subscriptionStatus: string | null; seats: number | null }

export const TENANT_STATUSES = ["active", "suspended"]
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)

export async function listTenants(db: Db, q: ListQuery): Promise<{ items: TenantListItem[]; page: number; pageSize: number; total: number }> {
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
  const items = page.map((r) => {
    const s = subs.get(r.id)
    return { id: r.id, slug: r.slug, name: r.name, status: r.status, createdAt: r.createdAt, planId: s?.planId ?? null, subscriptionStatus: s?.status ?? null, seats: s?.seats ?? null }
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
}

/** The 360 view: metadata plus aggregates only (counts and one date). No member, subject or business data is selected. */
export async function tenantDetail(db: Db, tenantId: string): Promise<TenantDetail> {
  const tenant = await getTenantMeta(db, tenantId)
  const id = tenant.id
  return withTenant(db, id, async (tx) => {
    const [s] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, id))
    const [seats] = await tx.select({ n: count() }).from(memberships).where(and(eq(memberships.tenantId, id), eq(memberships.status, "active")))
    const [members] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.tenantId, id))
    const overrides = await tx.select({ module: moduleOverrides.module, mode: moduleOverrides.mode, reason: moduleOverrides.reason, setAt: moduleOverrides.setAt }).from(moduleOverrides).where(eq(moduleOverrides.tenantId, id)).orderBy(moduleOverrides.module)
    const [last] = await tx.select({ at: max(auditEvents.at) }).from(auditEvents).where(and(eq(auditEvents.tenantId, id), or(isNull(auditEvents.actorId), not(like(auditEvents.actorId, "platform:%")))))
    const [open] = await tx.select({ n: count() }).from(dataRequests).where(and(eq(dataRequests.tenantId, id), inArray(dataRequests.status, ["pending", "running"])))
    return {
      tenant,
      subscription: s ? { planId: s.planId, status: s.status, seats: s.seats, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd, hasProviderSubscription: s.providerSubscriptionId !== null } : null,
      seatsUsed: seats.n, memberCount: members.n, moduleOverrides: overrides,
      lastActivityDate: last?.at ? new Date(last.at).toISOString().slice(0, 10) : null,
      openDataRequests: open.n,
    }
  })
}
