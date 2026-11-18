import { and, eq } from "drizzle-orm"
import { AppError, NotFound } from "../../core/errors"
import { dataRequests, tenants } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import type { Db, Deps } from "../../deps"
import { resolveByPlatform } from "../gdpr"
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
export const RESOLVE_NOTE_MAX = 500

/**
 * POST /v1/platform/data-requests/{id}/resolve (`{ outcome: "completed" | "rejected", note }`). The request id is all the caller has, so the tenant is found one tenant at a time under that tenant's
 * own RLS context (the same O(tenants) pattern as the list; RLS is never bypassed), then the tenant-side change goes through the gdpr service. Order: 404 `data_request_not_found` (an unknown id,
 * a non-uuid and another staff member's typo all look alike) BEFORE the body is validated (422 `invalid_outcome` | `invalid_note`), then 409 `request_not_processing` from the service.
 * Returns ids, kind, status and the completion time only: never the subject, the requester or the reason.
 */
export async function resolveDataRequest(deps: Deps, staff: { userId: string }, id: unknown, input: { outcome?: unknown; note?: unknown }): Promise<{ id: string; tenantId: string; kind: string; status: string; completedAt: Date | null }> {
  if (typeof id !== "string" || !UUID.test(id)) throw NotFound("data_request_not_found")
  const rid = id.toLowerCase()
  const ts = await deps.db.select({ id: tenants.id }).from(tenants)
  let tenantId: string | null = null
  for (const t of ts) {
    const [hit] = await withTenant(deps.db, t.id, (tx) => tx.select({ id: dataRequests.id }).from(dataRequests).where(and(eq(dataRequests.tenantId, t.id), eq(dataRequests.id, rid))))
    if (hit) { tenantId = t.id; break }
  }
  if (!tenantId) throw NotFound("data_request_not_found")
  if (input.outcome !== "completed" && input.outcome !== "rejected") throw unprocessable("invalid_outcome")
  const note = typeof input.note === "string" ? input.note.trim() : ""
  if (note.length < 1 || note.length > RESOLVE_NOTE_MAX) throw unprocessable("invalid_note")
  const r = await resolveByPlatform(deps, tenantId, staff, rid, input.outcome, note)
  return { id: r.id, tenantId, kind: r.kind, status: r.status, completedAt: r.completedAt ? new Date(r.completedAt) : null }
}
