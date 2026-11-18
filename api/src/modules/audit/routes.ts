import { createRoute, z } from "@hono/zod-openapi"
import { desc, eq } from "drizzle-orm"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { auditEvents } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { checkAuditFilter, listAuditPage, streamAuditCsv, type AuditFilterInput } from "./query"
import { recordAudit } from "./record"

const Row = z.object({
  seq: z.number(), at: z.string(), actorId: z.string().nullable(), action: z.string(), entity: z.string(), entityId: z.string(),
  before: z.unknown(), after: z.unknown(), hash: z.string(),
})
const Filter = z.object({
  entity: z.string().min(1).max(64).optional(),
  actorId: z.string().min(1).max(64).optional().openapi({ description: "Only this member's entries (the opaque member id, as `actorId` on a row). An unknown id is an empty page", example: "u8k2m4n6p8q0r2s4t6v8w0x2y4z6a8b0" }),
  action: z.string().min(1).max(100).optional().openapi({ description: "Exact action, for example `role.updated`. Not with actionPrefix (400 invalid_filter)", example: "role.updated" }),
  actionPrefix: z.string().min(1).max(100).optional().openapi({ description: "Actions starting with this text, literally (`task.` for every task action). Not with action (400 invalid_filter)", example: "task." }),
  from: z.iso.datetime().optional().openapi({ description: "Entries at or after this instant", example: "2026-11-01T00:00:00.000Z" }),
  to: z.iso.datetime().optional().openapi({ description: "Entries at or before this instant; before `from` is 400 invalid_range", example: "2026-11-30T23:59:59.999Z" }),
})
const ListOut = z.object({
  items: z.array(Row),
  nextCursor: z.string().nullable().openapi({ description: "Pass as `cursor` for the next (older) page; null on the last page", example: "MjAyNi0xMS0wMVQwMDowNTowMC4wMDBafDAxOTNiNmQ0LTAwMDAtNzAwMC04MDAwLTAwMDAwMDAwMDAwMQ" }),
})

const listRoute = createRoute({
  method: "get", path: "/v1/audit", middleware: [requireTenant, requirePermission("audit", "read")] as const,
  request: { query: Filter.extend({ limit: z.coerce.number().int().min(1).max(100).default(50).openapi({ example: 50 }), cursor: z.string().min(1).max(200).optional().openapi({ description: "The `nextCursor` of the previous page. Anything else is 400 invalid_cursor (also another tenant's cursor)", example: "MjAyNi0xMS0wMVQwMDowNTowMC4wMDBafDAxOTNiNmQ0LTAwMDAtNzAwMC04MDAwLTAwMDAwMDAwMDAwMQ" }) }) },
  responses: { 200: { description: "One page of audit entries in chain order, newest (highest seq) first, filtered by actor, action (exact or prefix), entity and time range. 400 invalid_filter (action with actionPrefix) | invalid_range (to before from) | invalid_cursor; limit 1 to 100, default 50. A read: the chain is never touched", content: { "application/json": { schema: ListOut } } } },
})
const exportRoute = createRoute({
  method: "get", path: "/v1/audit/export", middleware: [requireTenant, requirePermission("audit", "read")] as const,
  request: { query: Filter.extend({ format: z.literal("csv") }) },
  responses: { 200: { description: "Every matching entry as CSV (streamed), same filters as the list (not paged). 400 invalid_filter | invalid_range", content: { "text/csv": { schema: z.string() } } } },
})

type FilterQuery = { entity?: string; actorId?: string; action?: string; actionPrefix?: string; from?: string; to?: string }
const filterOf = (q: FilterQuery): AuditFilterInput => ({
  entity: q.entity, actorId: q.actorId, action: q.action, actionPrefix: q.actionPrefix, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined,
})

export const auditRoutes = newRouter()
  .openapi(listRoute, async (c) => {
    const t = c.get("tenant")!
    const q = c.req.valid("query")
    const { rows, nextCursor } = await listAuditPage(c.get("deps").db, t.id, filterOf(q), { cursor: q.cursor, limit: q.limit })
    return c.json({ items: rows.map((r) => ({ seq: r.seq, at: r.at.toISOString(), actorId: r.actorId, action: r.action, entity: r.entity, entityId: r.entityId, before: r.before, after: r.after, hash: r.hash })), nextCursor }, 200)
  })
  .openapi(exportRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const q = c.req.valid("query")
    const filter = filterOf(q)
    checkAuditFilter(filter) // before the export is recorded: a refused request leaves no trace
    // Pin the snapshot and record the export in ONE transaction, before any byte is sent: an export that leaves no trace cannot happen.
    const upToSeq = await withTenant(deps.db, t.id, async (tx) => {
      const [last] = await tx.select({ seq: auditEvents.seq }).from(auditEvents).where(eq(auditEvents.tenantId, t.id)).orderBy(desc(auditEvents.seq)).limit(1)
      await recordAudit(
        tx, t.id,
        { action: "audit.exported", entity: "audit", entityId: "export", actorId: c.get("member")!.userId, before: null, after: { format: "csv", entity: q.entity ?? null, actorId: q.actorId ?? null, action: q.action ?? null, actionPrefix: q.actionPrefix ?? null, from: q.from ?? null, to: q.to ?? null, upToSeq: last?.seq ?? 0 } },
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
