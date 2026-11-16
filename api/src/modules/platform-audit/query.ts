import { and, desc, eq, gte, lt, lte } from "drizzle-orm"
import { csvCell } from "@opsdesk/domain/csv"
import type { Db } from "../../db/client"
import { platformAuditEvents } from "../../db/schema"

export type PlatformAuditRow = typeof platformAuditEvents.$inferSelect
export type PlatformAuditFilter = { entity?: string; targetTenantId?: string; from?: Date; to?: Date; limit?: number }
type Paging = { beforeSeq?: number }

/** Newest first. */
export function listPlatformAudit(db: Db, f: PlatformAuditFilter & Paging): Promise<PlatformAuditRow[]> {
  return db
    .select()
    .from(platformAuditEvents)
    .where(
      and(
        f.beforeSeq !== undefined ? lt(platformAuditEvents.seq, f.beforeSeq) : undefined,
        f.entity ? eq(platformAuditEvents.entity, f.entity) : undefined,
        f.targetTenantId ? eq(platformAuditEvents.targetTenantId, f.targetTenantId) : undefined,
        f.from ? gte(platformAuditEvents.at, f.from) : undefined,
        f.to ? lte(platformAuditEvents.at, f.to) : undefined,
      ),
    )
    .orderBy(desc(platformAuditEvents.seq))
    .limit(f.limit ?? 1000)
}

const HEADER = "at,actor,action,entity,entity_id,target_tenant_id,before,after"
const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v))
type CsvRow = Pick<PlatformAuditRow, "at" | "actorId" | "action" | "entity" | "entityId" | "targetTenantId" | "before" | "after">
const line = (r: CsvRow) =>
  [r.at.toISOString(), r.actorId, r.action, r.entity, r.entityId, r.targetTenantId ?? "", json(r.before), json(r.after)].map(csvCell).join(",")

/** The tenant CSV shape plus a target_tenant_id column. Lines end with \n; cells escaped and formula-safe. */
export function platformAuditToCsv(rows: CsvRow[]): string {
  return [HEADER, ...rows.map(line)].join("\n") + "\n"
}

/** Streams ALL matching rows in keyset pages (newest first); `upToSeq` pins a snapshot (rows with seq <= it). */
export function streamPlatformAuditCsv(
  db: Db,
  f: Pick<PlatformAuditFilter, "entity" | "targetTenantId" | "from" | "to">,
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
      const page = await listPlatformAudit(db, { ...f, limit: pageSize, beforeSeq: cursor })
      if (page.length > 0) ctrl.enqueue(enc.encode(page.map(line).join("\n") + "\n"))
      if (page.length < pageSize) return ctrl.close()
      cursor = page[page.length - 1].seq
    },
  })
}
