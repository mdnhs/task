import { createRoute, z } from "@hono/zod-openapi"
import { requireTenant } from "../../core/middleware/tenant"
import { visibleModules } from "../../core/middleware/permission"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import { parseLimit, searchDocuments } from "./service"

const Hit = z.object({ entity: z.string(), entityId: z.string(), title: z.string(), module: z.string() })

// q and limit are validated by the service (422 invalid_query / clamped), not by zod (which would answer 400).
const searchRoute = createRoute({
  method: "get", path: "/v1/search", middleware: [requireTenant] as const,
  request: { query: z.object({ q: z.string().optional().openapi({ example: "alex" }), limit: z.string().optional().openapi({ example: "10" }) }) },
  responses: {
    200: { description: "Hits among the modules the caller can read, best first. q is 2..100 chars after trim else 422 invalid_query; limit defaults to 10 and is clamped to 1..20", content: { "application/json": { schema: z.object({ hits: z.array(Hit) }) } } },
  },
})

export const searchRoutes = newRouter().openapi(searchRoute, async (c) => {
  const t = c.get("tenant")!
  const { q, limit } = c.req.valid("query")
  const modules = await visibleModules(c)
  const hits = await withTenant(c.get("deps").db, t.id, (tx) => searchDocuments(tx, t.id, modules, q, parseLimit(limit)))
  return c.json({ hits }, 200)
})
