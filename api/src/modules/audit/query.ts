import { and, desc, eq, gte, lte } from "drizzle-orm"
import type { Db } from "../../db/client"
import { auditEvents } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { csvCell } from "@opsdesk/domain/csv"

export type AuditRow = typeof auditEvents.$inferSelect
export type AuditFilter = { entity?: string; from?: Date; to?: Date; limit?: number }

/** Newest first. The HTTP route (T1.4) adds the `audit` read permission around this. */
export function listAudit(db: Db, tenantId: string, f: AuditFilter): Promise<AuditRow[]> {
  return withTenant(db, tenantId, (tx) =>
    tx
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, tenantId),
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

/** CSV of who, what, when, old and new value. Lines end with \n; cells escaped and formula-safe. */
export function auditToCsv(rows: Pick<AuditRow, "at" | "actorId" | "action" | "entity" | "entityId" | "before" | "after">[]): string {
  const lines = rows.map((r) =>
    [r.at.toISOString(), r.actorId ?? "", r.action, r.entity, r.entityId, json(r.before), json(r.after)].map(csvCell).join(","),
  )
  return [HEADER, ...lines].join("\n") + "\n"
}
