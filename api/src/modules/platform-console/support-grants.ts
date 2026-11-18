import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from "drizzle-orm"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import type { PlatformRole } from "../../core/context"
import { memberships, roles, supportGrantIndex, supportGrants, tenants, user } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { notify, withTenantAfterCommit } from "../notifications"
import { recordPlatformAudit } from "../platform-audit"
import { decodeCursor, encodeCursor } from "../tasks"
import { assertReason } from "./lifecycle"
import { getTenantMeta, TenantNotFound } from "./tenants"

/**
 * Support access grants (T3.5): a platform staff member may READ one tenant for 1..24 hours. Enforcement is in
 * core/middleware/support.ts (the grant path of requireTenant); this file creates, lists and revokes grants.
 *
 * Platform-side reads/writes of the tenant table go through withTenant(tenantId) (RLS never bypassed). The tenant-less
 * DELETE /v1/platform/support-grants/{id} finds the tenant through support_grant_index, an ids-only platform map
 * (grant id -> tenant id, ruling C9), written in the same transaction as the grant.
 */

const HOUR_MS = 3_600_000
// Two-key advisory lock namespace for support grants ("supp"): distinct from sett/rbac/intg/dsr/team/dev/seat/life/PLAT.
const SUPPORT_LOCK_NS = 0x73757070
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const GrantNotFound = () => NotFound("grant_not_found")

export type GrantStatus = "active" | "expired" | "revoked"
type GrantRow = typeof supportGrants.$inferSelect
export type GrantView = {
  id: string; tenantId: string; staffUserId: string; reason: string; grantedBy: string
  startsAt: Date; expiresAt: Date; revokedAt: Date | null; status: GrantStatus
}

const isActive = (g: GrantRow, now: Date) => g.revokedAt === null && g.startsAt <= now && now < g.expiresAt
const statusOf = (g: GrantRow, now: Date): GrantStatus => (g.revokedAt !== null ? "revoked" : isActive(g, now) ? "active" : "expired")
const view = (g: GrantRow, now: Date): GrantView => ({
  id: g.id, tenantId: g.tenantId, staffUserId: g.staffUserId, reason: g.reason, grantedBy: g.grantedBy,
  startsAt: g.startsAt, expiresAt: g.expiresAt, revokedAt: g.revokedAt, status: statusOf(g, now),
})

const lock = (tx: TenantTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(${SUPPORT_LOCK_NS}::int4, hashtext(${tenantId}::text))`)

/** `hours` is an integer 1..24, else 422 invalid_hours. */
function assertHours(hours: unknown): number {
  if (typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > 24) throw unprocessable("invalid_hours")
  return hours
}

/**
 * Creates a grant for the CALLING staff member (never anyone else) on an active tenant. Order: 404 tenant_not_found
 * (unknown, non-uuid or suspended tenant) before any body validation, then 422 invalid_reason / invalid_hours, then 409
 * grant_exists when this staff member already holds an active grant for the tenant. One transaction: support lock ->
 * grant + index row -> tenant audit (actor platform:<staffId>) -> platform audit (lock last) -> a "security"
 * notification to every active tenant owner (in-app row in the tx; email/push enqueued after commit, never quiet-held).
 */
export async function createSupportGrant(deps: Deps, tenantId: string, staff: { userId: string }, input: { reason?: unknown; hours?: unknown }): Promise<GrantView> {
  const meta = await getTenantMeta(deps.db, tenantId)
  if (meta.status !== "active") throw TenantNotFound()
  const reason = assertReason(input.reason)
  const hours = assertHours(input.hours)
  const now = deps.clock.now()
  const expiresAt = new Date(now.getTime() + hours * HOUR_MS)
  const actorId = `platform:${staff.userId}`
  return withTenantAfterCommit(deps, meta.id, async (tx, enqueue) => {
    await lock(tx, meta.id)
    const [open] = await tx.select({ id: supportGrants.id }).from(supportGrants).where(and(
      eq(supportGrants.tenantId, meta.id), eq(supportGrants.staffUserId, staff.userId), isNull(supportGrants.revokedAt), lte(supportGrants.startsAt, now), gt(supportGrants.expiresAt, now),
    )).limit(1)
    if (open) throw Conflict("grant_exists")
    const [g] = await tx.insert(supportGrants).values({ tenantId: meta.id, staffUserId: staff.userId, reason, grantedBy: staff.userId, startsAt: now, expiresAt }).returning()
    await tx.insert(supportGrantIndex).values({ grantId: g.id, targetTenantId: meta.id })
    const after = { staffUserId: staff.userId, reason, hours, startsAt: now, expiresAt }
    await recordAudit(tx, meta.id, { action: "support.granted", entity: "support_grant", entityId: g.id, actorId, before: null, after }, now)
    await recordPlatformAudit(tx, { action: "platform.support.granted", entity: "support_grant", entityId: g.id, actorId: staff.userId, targetTenantId: meta.id, before: null, after }, now)
    const owners = await tx.select({ userId: memberships.userId }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.tenantId, meta.id), eq(memberships.status, "active"), eq(roles.key, "owner")))
    for (const o of owners) {
      await notify(tx, meta.id, {
        userId: o.userId, kind: "security", title: "Support access granted",
        body: `Platform support can read (not change) your workspace until ${expiresAt.toISOString()}. Reason: ${reason}. You can revoke it in Settings > Support access.`,
        link: "/settings/support-access",
      }, deps, enqueue)
    }
    return view(g, now)
  })
}

/** Revokes (sets revoked_at). Both chains audited. 409 grant_inactive when it is already revoked or expired. */
async function revokeIn(deps: Deps, tenantId: string, grantId: string, authorise: (g: GrantRow) => void, by: { tenantActor: string; platformActor: string }): Promise<GrantView> {
  const now = deps.clock.now()
  return withTenant(deps.db, tenantId, async (tx) => {
    await lock(tx, tenantId)
    const [g] = await tx.select().from(supportGrants).where(and(eq(supportGrants.id, grantId), eq(supportGrants.tenantId, tenantId))).for("update")
    if (!g) throw GrantNotFound()
    authorise(g)
    if (!isActive(g, now)) throw Conflict("grant_inactive")
    const [row] = await tx.update(supportGrants).set({ revokedAt: now, revokedBy: by.tenantActor }).where(eq(supportGrants.id, g.id)).returning()
    const before = { status: "active", expiresAt: g.expiresAt }
    const after = { status: "revoked", revokedAt: now, revokedBy: by.tenantActor, staffUserId: g.staffUserId }
    await recordAudit(tx, tenantId, { action: "support.revoked", entity: "support_grant", entityId: g.id, actorId: by.tenantActor, before, after }, now)
    await recordPlatformAudit(tx, { action: "platform.support.revoked", entity: "support_grant", entityId: g.id, actorId: by.platformActor, targetTenantId: tenantId, before, after }, now)
    return view(row, now)
  })
}

/**
 * Platform revoke: the platform owner may revoke any grant, the grantee their own; any other staff 403 platform_forbidden.
 * Unknown (or non-uuid) id 404 grant_not_found. The tenant is found through the ids-only support_grant_index.
 */
export async function revokeSupportGrantAsStaff(deps: Deps, grantId: string, staff: { userId: string; role: PlatformRole }): Promise<GrantView> {
  if (!UUID.test(grantId)) throw GrantNotFound()
  const id = grantId.toLowerCase()
  const [idx] = await deps.db.select({ tenantId: supportGrantIndex.targetTenantId }).from(supportGrantIndex).where(eq(supportGrantIndex.grantId, id))
  if (!idx) throw GrantNotFound()
  return revokeIn(deps, idx.tenantId, id, (g) => {
    if (staff.role !== "owner" && g.staffUserId !== staff.userId) throw Forbidden("platform_forbidden")
  }, { tenantActor: `platform:${staff.userId}`, platformActor: staff.userId })
}

/**
 * Tenant revoke (tenant owner; the route checks the role). In the platform chain the actor is `tenant:<member user id>`
 * (see the actor catalogue in platform-audit/record.ts; the tenant chain keeps the raw id). Another tenant's grant id is 404 grant_not_found (RLS + tenant filter).
 */
export async function revokeSupportGrantAsTenant(deps: Deps, tenantId: string, memberUserId: string, grantId: string): Promise<GrantView> {
  if (!UUID.test(grantId)) throw GrantNotFound()
  return revokeIn(deps, tenantId, grantId.toLowerCase(), () => {}, { tenantActor: memberUserId, platformActor: `tenant:${memberUserId}` })
}

/** The tenant's grants, newest first (at most 200), with the staff member's display name. */
export async function listSupportGrants(deps: Deps, tenantId: string): Promise<(GrantView & { staffName: string | null })[]> {
  const now = deps.clock.now()
  const rows = await withTenant(deps.db, tenantId, (tx) =>
    tx.select({ g: supportGrants, staffName: user.name }).from(supportGrants).leftJoin(user, eq(user.id, supportGrants.staffUserId))
      .where(eq(supportGrants.tenantId, tenantId)).orderBy(desc(supportGrants.startsAt), desc(supportGrants.id)).limit(200),
  )
  return rows.map((r) => ({ ...view(r.g, now), staffName: r.staffName }))
}

export type StaffGrantItem = GrantView & { tenantName: string; staffName: string | null }

/**
 * The staff list (read-only, every platform role): grants across tenants, newest first by (starts_at, id) with a keyset cursor (the tasks codec). RLS is never bypassed:
 * the candidate tenants come from the ids-only support_grant_index (or the one `tenantId` filter, 404 tenant_not_found when unknown) and each tenant's rows are read under
 * withTenant(), the status filter and cursor pushed into SQL and capped at limit+1 per tenant before the merge. O(tenants that ever held a grant) round trips, accepted for
 * Phase 1 (see eachTenant in tenants.ts for the scale limit). Writes no audit row (a read); one info log line names the staff member and how many tenants were read.
 */
export async function listSupportGrantsForStaff(deps: Deps, staff: { userId: string }, q: { tenantId?: string; status?: GrantStatus; limit: number; cursor?: string }): Promise<{ items: StaffGrantItem[]; nextCursor: string | null }> {
  const now = deps.clock.now()
  const after = q.cursor ? decodeCursor(q.cursor) : undefined
  let candidates: { id: string; name: string }[]
  if (q.tenantId !== undefined) {
    const meta = await getTenantMeta(deps.db, q.tenantId)
    candidates = [{ id: meta.id, name: meta.name }]
  } else {
    const idx = deps.db.selectDistinct({ id: supportGrantIndex.targetTenantId }).from(supportGrantIndex)
    candidates = await deps.db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(inArray(tenants.id, idx))
  }
  const statusCond = (): SQL | undefined => {
    if (q.status === "revoked") return isNotNull(supportGrants.revokedAt)
    if (q.status === "active") return and(isNull(supportGrants.revokedAt), lte(supportGrants.startsAt, now), gt(supportGrants.expiresAt, now))
    if (q.status === "expired") return and(isNull(supportGrants.revokedAt), or(gt(supportGrants.startsAt, now), lte(supportGrants.expiresAt, now)))
    return undefined
  }
  const afterCond = after ? or(lt(supportGrants.startsAt, after.at), and(eq(supportGrants.startsAt, after.at), lt(supportGrants.id, after.id))) : undefined
  const all: StaffGrantItem[] = []
  for (const t of candidates) {
    const rows = await withTenant(deps.db, t.id, (tx) =>
      tx.select({ g: supportGrants, staffName: user.name }).from(supportGrants).leftJoin(user, eq(user.id, supportGrants.staffUserId))
        .where(and(eq(supportGrants.tenantId, t.id), statusCond(), afterCond)).orderBy(desc(supportGrants.startsAt), desc(supportGrants.id)).limit(q.limit + 1),
    )
    for (const r of rows) all.push({ ...view(r.g, now), tenantName: t.name, staffName: r.staffName })
  }
  all.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  const page = all.slice(0, q.limit)
  const last = page[page.length - 1]
  deps.logger.info({ staffUserId: staff.userId, tenantFilter: q.tenantId ?? null, tenants: candidates.length, returned: page.length }, "support_grant.list")
  return { items: page, nextCursor: all.length > q.limit && last ? encodeCursor(last.startsAt, last.id) : null }
}
