import { and, desc, eq, gte, lt, lte, sql } from "drizzle-orm"
import { AppError } from "../../core/errors"
import { decodeCursor, encodeCursor } from "../../core/cursor"
import type { Db } from "../../db/client"
import { auditEvents } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { csvCell } from "@opsdesk/domain/csv"

export type AuditRow = typeof auditEvents.$inferSelect
/** `actorId` is the opaque member id (text, not a uuid: Better Auth ids). `action` (exact) and `actionPrefix` (literal, no wildcards) exclude each other; `from` and `to` bound `at`, inclusive. */
export type AuditFilter = { entity?: string; actorId?: string; action?: string; actionPrefix?: string; from?: Date; to?: Date; limit?: number }
export type AuditFilterInput = Pick<AuditFilter, "entity" | "actorId" | "action" | "actionPrefix" | "from" | "to">
/** Keyset pagination for export: rows strictly below `beforeSeq`. */
type Paging = { beforeSeq?: number }

/** What the filters mean together, checked before any query: 400 invalid_filter (action with actionPrefix) or 400 invalid_range (to before from). */
export function checkAuditFilter(f: Pick<AuditFilter, "action" | "actionPrefix" | "from" | "to">): void {
  if (f.action !== undefined && f.actionPrefix !== undefined) throw new AppError(400, "invalid_filter", "Bad Request")
  if (f.from && f.to && f.to < f.from) throw new AppError(400, "invalid_range", "Bad Request")
}

const where = (tenantId: string, f: AuditFilter & Paging) =>
  and(
    eq(auditEvents.tenantId, tenantId),
    f.beforeSeq !== undefined ? lt(auditEvents.seq, f.beforeSeq) : undefined,
    f.entity ? eq(auditEvents.entity, f.entity) : undefined,
    f.actorId ? eq(auditEvents.actorId, f.actorId) : undefined,
    f.action ? eq(auditEvents.action, f.action) : undefined,
    f.actionPrefix ? sql`starts_with(${auditEvents.action}, ${f.actionPrefix})` : undefined, // literal prefix: `%` and `_` are not wildcards
    f.from ? gte(auditEvents.at, f.from) : undefined,
    f.to ? lte(auditEvents.at, f.to) : undefined,
  )

/** Newest first. The HTTP route (T1.4) adds the `audit` read permission around this. */
export function listAudit(db: Db, tenantId: string, f: AuditFilter & Paging): Promise<AuditRow[]> {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(auditEvents)
      .where(where(tenantId, f))
      .orderBy(desc(auditEvents.seq))
      .limit(f.limit ?? 1000),
  )
}

export type AuditPage = { rows: AuditRow[]; nextCursor: string | null }

/**
 * One page (ruling S7): chain order, newest first (`seq` desc: the gap-free per-tenant sequence, so equal timestamps never reorder or repeat). The cursor is the shared opaque codec of the
 * last row (`<at>|<id>`); it is resolved to that row's `seq` INSIDE this tenant's RLS scope, so a cursor of another tenant, a deleted row or a forged time finds nothing and is 400 invalid_cursor.
 * `limit + 1` rows are read to know whether a next page exists. Reads only.
 */
export function listAuditPage(db: Db, tenantId: string, f: AuditFilter, o: { cursor?: string; limit: number }): Promise<AuditPage> {
  checkAuditFilter(f)
  const after = o.cursor === undefined ? undefined : decodeCursor(o.cursor)
  return withTenant(db, tenantId, async (tx) => {
    let beforeSeq: number | undefined
    if (after) {
      const [at] = await tx.select({ seq: auditEvents.seq, at: auditEvents.at }).from(auditEvents).where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.id, after.id)))
      if (!at || at.at.getTime() !== after.at.getTime()) throw new AppError(400, "invalid_cursor", "Bad Request")
      beforeSeq = at.seq
    }
    const rows = await tx.select().from(auditEvents).where(where(tenantId, { ...f, beforeSeq })).orderBy(desc(auditEvents.seq)).limit(o.limit + 1)
    const more = rows.length > o.limit
    const items = more ? rows.slice(0, o.limit) : rows
    const last = items[items.length - 1]
    return { rows: items, nextCursor: more && last ? encodeCursor(last.at, last.id) : null }
  })
}

const HEADER = "at,actor,action,entity,entity_id,before,after"
const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v))

const line = (r: Pick<AuditRow, "at" | "actorId" | "action" | "entity" | "entityId" | "before" | "after">) =>
  [r.at.toISOString(), r.actorId ?? "", r.action, r.entity, r.entityId, json(r.before), json(r.after)].map(csvCell).join(",")

/** CSV of who, what, when, old and new value. Lines end with \n; cells escaped and formula-safe. */
export function auditToCsv(rows: Pick<AuditRow, "at" | "actorId" | "action" | "entity" | "entityId" | "before" | "after">[]): string {
  return [HEADER, ...rows.map(line)].join("\n") + "\n"
}

/**
 * The same CSV as a stream that walks ALL matching rows in keyset pages (newest first), so an export is never cut off at
 * the list limit and never holds the whole log in memory. `upToSeq` pins a snapshot (rows with seq <= it); each page is its own short transaction.
 */
export function streamAuditCsv(
  db: Db,
  tenantId: string,
  f: AuditFilterInput,
  o: { pageSize?: number; upToSeq?: number } = {},
): ReadableStream<Uint8Array> {
  const pageSize = o.pageSize ?? 500
  const enc = new TextEncoder()
  let cursor = o.upToSeq !== undefined ? o.upToSeq + 1 : undefined
  let started = false
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (!started) {
        started = true
        ctrl.enqueue(enc.encode(HEADER + "\n"))
      }
      const page = await listAudit(db, tenantId, { ...f, limit: pageSize, beforeSeq: cursor })
      if (page.length > 0) ctrl.enqueue(enc.encode(page.map(line).join("\n") + "\n"))
      if (page.length < pageSize) return ctrl.close()
      cursor = page[page.length - 1].seq
    },
  })
}
