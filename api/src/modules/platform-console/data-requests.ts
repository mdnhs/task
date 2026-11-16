import { eq } from "drizzle-orm"
import { dataRequests, tenants } from "../../db/schema"
import type { Db } from "../../deps"
import { eachTenant } from "./tenants"

export type PlatformDataRequest = { id: string; tenantId: string; tenantName: string; kind: string; status: string; createdAt: Date; dueAt: Date; overdue: boolean }

/**
 * Cross-tenant GDPR request list for the platform console. Never selects subject_user_id, requested_by, reason or notes:
 * only tenant, kind, status and dates. Overdue = still open (pending/running) and past its due date. Overdue first, then
 * due date ascending. O(tenants) under per-tenant RLS (see eachTenant), paginated in memory.
 */
export async function listPlatformDataRequests(db: Db, now: Date, o: { page: number; pageSize: number }): Promise<{ items: PlatformDataRequest[]; page: number; pageSize: number; total: number }> {
  const ts = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
  const rows = await eachTenant(db, ts.map((t) => t.id), (tx, id) =>
    tx.select({ id: dataRequests.id, kind: dataRequests.kind, status: dataRequests.status, createdAt: dataRequests.createdAt, dueAt: dataRequests.dueAt }).from(dataRequests).where(eq(dataRequests.tenantId, id)),
  )
  const name = new Map(ts.map((t) => [t.id, t.name]))
  const all: PlatformDataRequest[] = rows.flatMap(({ tenantId, value }) =>
    value.map((r) => ({ ...r, tenantId, tenantName: name.get(tenantId) ?? "", overdue: (r.status === "pending" || r.status === "running") && r.dueAt < now })),
  )
  all.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id))
  return { items: all.slice((o.page - 1) * o.pageSize, o.page * o.pageSize), page: o.page, pageSize: o.pageSize, total: all.length }
}
