import { and, desc, eq, gte, lt, lte } from "drizzle-orm"
import type { Db } from "../../db/client"
import { auditEvents } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { csvCell } from "@opsdesk/domain/csv"

export type AuditRow = typeof auditEvents.$inferSelect
export type AuditFilter = { entity?: string; from?: Date; to?: Date; limit?: number }
/** Keyset pagination for export: rows strictly below `beforeSeq`. */
type Paging = { beforeSeq?: number }

/** Newest first. The HTTP route (T1.4) adds the `audit` read permission around this. */
export function listAudit(db: Db, tenantId: string, f: AuditFilter & Paging): Promise<AuditRow[]> {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenantId),
          f.beforeSeq !== undefined ? lt(auditEvents.seq, f.beforeSeq) : undefined,
          f.entity ? eq(auditEvents.entity, f.entity) : undefined,
          f.from ? gte(auditEvents.at, f.from) : undefined,
          f.to ? lte(auditEvents.at, f.to) : undefined,
        ),
      )
      .orderBy(desc(auditEvents.seq))
      .limit(f.limit ?? 1000),
  )
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
  f: Pick<AuditFilter, "entity" | "from" | "to">,
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
