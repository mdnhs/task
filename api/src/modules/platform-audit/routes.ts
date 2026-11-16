import { createRoute, z } from "@hono/zod-openapi"
import { desc } from "drizzle-orm"
import { requirePlatformStaff } from "../../core/middleware/platform"
import { newRouter } from "../../core/router"
import { platformAuditEvents } from "../../db/schema"
import { listPlatformAudit, streamPlatformAuditCsv } from "./query"
import { recordPlatformAudit } from "./record"


const Filter = z.object({
  entity: z.string().min(1).max(64).optional(),
  targetTenantId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
})
const Row = z.object({
  seq: z.number(), at: z.string(), actorId: z.string(), action: z.string(), entity: z.string(), entityId: z.string(),
  targetTenantId: z.string().nullable(), before: z.unknown(), after: z.unknown(), hash: z.string(),
})

const listRoute = createRoute({
  method: "get", path: "/v1/platform/audit", middleware: [requirePlatformStaff("owner", "viewer")] as const,
  request: { query: Filter.extend({ limit: z.coerce.number().int().min(1).max(1000).optional() }) },
  responses: { 200: { description: "Platform audit entries, newest first", content: { "application/json": { schema: z.array(Row) } } } },
})
const exportRoute = createRoute({
  method: "get", path: "/v1/platform/audit/export", middleware: [requirePlatformStaff("owner", "viewer")] as const,
  request: { query: Filter.extend({ format: z.literal("csv") }) },
  responses: { 200: { description: "Every matching entry as CSV (streamed)", content: { "text/csv": { schema: z.string() } } } },
})

const dates = (q: { from?: string; to?: string }) => ({ from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined })

export const platformAuditRoutes = newRouter()
  .openapi(listRoute, async (c) => {
    const q = c.req.valid("query")
    const rows = await listPlatformAudit(c.get("deps").db, { entity: q.entity, targetTenantId: q.targetTenantId, ...dates(q), limit: q.limit })
    return c.json(rows.map((r) => ({ seq: r.seq, at: r.at.toISOString(), actorId: r.actorId, action: r.action, entity: r.entity, entityId: r.entityId, targetTenantId: r.targetTenantId, before: r.before, after: r.after, hash: r.hash })), 200)
  })
  .openapi(exportRoute, async (c) => {
    const deps = c.get("deps")
    const q = c.req.valid("query")
    const filter = { entity: q.entity, targetTenantId: q.targetTenantId, ...dates(q) }
    // Pin the snapshot and record the export in ONE transaction, before any byte is sent: an export that leaves no trace cannot happen.
    const upToSeq = await deps.db.transaction(async (tx) => {
      const [last] = await tx.select({ seq: platformAuditEvents.seq }).from(platformAuditEvents).orderBy(desc(platformAuditEvents.seq)).limit(1)
      await recordPlatformAudit(
        tx,
        { action: "platform.audit.exported", entity: "platform_audit", entityId: "export", actorId: c.get("staff")!.userId, before: null, after: { format: "csv", entity: q.entity ?? null, targetTenantId: q.targetTenantId ?? null, from: q.from ?? null, to: q.to ?? null, upToSeq: last?.seq ?? 0 } },
        deps.clock.now(),
      )
      return last?.seq ?? 0
    })
    return c.body(streamPlatformAuditCsv(deps.db, filter, { upToSeq }), 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="platform-audit.csv"',
      "cache-control": "no-store",
    }) as never
  })
