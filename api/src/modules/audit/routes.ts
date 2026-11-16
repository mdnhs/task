import { createRoute, z } from "@hono/zod-openapi"
import { desc, eq } from "drizzle-orm"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { auditEvents } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { listAudit, streamAuditCsv } from "./query"
import { recordAudit } from "./record"

const Filter = z.object({
  entity: z.string().min(1).max(64).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
})
const Row = z.object({
  seq: z.number(), at: z.string(), actorId: z.string().nullable(), action: z.string(), entity: z.string(), entityId: z.string(),
  before: z.unknown(), after: z.unknown(), hash: z.string(),
})

const listRoute = createRoute({
  method: "get", path: "/v1/audit", middleware: [requireTenant, requirePermission("audit", "read")] as const,
  request: { query: Filter.extend({ limit: z.coerce.number().int().min(1).max(1000).optional() }) },
  responses: { 200: { description: "Audit entries, newest first", content: { "application/json": { schema: z.array(Row) } } } },
})
const exportRoute = createRoute({
  method: "get", path: "/v1/audit/export", middleware: [requireTenant, requirePermission("audit", "read")] as const,
  request: { query: Filter.extend({ format: z.literal("csv") }) },
  responses: { 200: { description: "Every matching entry as CSV (streamed)", content: { "text/csv": { schema: z.string() } } } },
})

export const auditRoutes = newRouter()
  .openapi(listRoute, async (c) => {
    const t = c.get("tenant")!
    const q = c.req.valid("query")
    const rows = await listAudit(c.get("deps").db, t.id, {
      entity: q.entity, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, limit: q.limit,
    })
    return c.json(rows.map((r) => ({ seq: r.seq, at: r.at.toISOString(), actorId: r.actorId, action: r.action, entity: r.entity, entityId: r.entityId, before: r.before, after: r.after, hash: r.hash })), 200)
  })
  .openapi(exportRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const q = c.req.valid("query")
    const filter = { entity: q.entity, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined }
    // Pin the snapshot and record the export in ONE transaction, before any byte is sent: an export that leaves no trace cannot happen.
    const upToSeq = await withTenant(deps.db, t.id, async (tx) => {
      const [last] = await tx.select({ seq: auditEvents.seq }).from(auditEvents).where(eq(auditEvents.tenantId, t.id)).orderBy(desc(auditEvents.seq)).limit(1)
      await recordAudit(
        tx, t.id,
        { action: "audit.exported", entity: "audit", entityId: "export", actorId: c.get("member")!.userId, before: null, after: { format: "csv", entity: q.entity ?? null, from: q.from ?? null, to: q.to ?? null, upToSeq: last?.seq ?? 0 } },
        deps.clock.now(),
      )
      return last?.seq ?? 0
    })
    return c.body(streamAuditCsv(deps.db, t.id, filter, { upToSeq }), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="audit.csv"',
      "cache-control": "no-store",
    }) as never
  })
