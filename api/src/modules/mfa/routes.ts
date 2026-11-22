import { createRoute, z } from "@hono/zod-openapi"
import { requirePermission } from "../../core/middleware/permission"
import { requireSession } from "../../core/middleware/session"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import { setMfaPolicy } from "./service"

const Policy = z.object({ mode: z.string(), roles: z.array(z.string()), enforcement: z.enum(["prompt", "strict"]).optional() })
// mode is a free string here on purpose: parseMfaPolicy is the single validator and answers 422 (not 400).
const PolicyBody = z
  .object({ mode: z.string().max(20), roles: z.array(z.string().max(64)).max(100).default([]), enforcement: z.string().max(10).optional() })
  .openapi({ example: { mode: "roles", roles: ["manager"] } })

const stateRoute = createRoute({
  method: "get",
  path: "/v1/me/mfa",
  middleware: [requireSession] as const,
  responses: { 200: { description: "Whether the caller has 2FA and whether this session passed it", content: { "application/json": { schema: z.object({ enrolled: z.boolean(), passed: z.boolean() }) } } } },
})
const getPolicyRoute = createRoute({
  method: "get",
  path: "/v1/settings/mfa-policy",
  middleware: [requireTenant, requirePermission("settings", "read")] as const,
  responses: { 200: { description: "The tenant's MFA policy", content: { "application/json": { schema: Policy } } } },
})
const putPolicyRoute = createRoute({
  method: "put",
  path: "/v1/settings/mfa-policy",
  middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { body: { content: { "application/json": { schema: PolicyBody } }, required: true } },
  responses: { 200: { description: "The stored policy", content: { "application/json": { schema: Policy } } } },
})

export const mfaRoutes = newRouter()
  .openapi(stateRoute, (c) => c.json({ enrolled: c.get("user")!.twoFactorEnabled, passed: c.get("session")!.mfaPassed }, 200))
  .openapi(getPolicyRoute, (c) => c.json(c.get("tenant")!.mfaPolicy, 200))
  .openapi(putPolicyRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const policy = await withTenant(deps.db, t.id, (tx) => setMfaPolicy(tx, t.id, c.get("member")!.userId, c.req.valid("json"), deps.clock.now()))
    return c.json(policy, 200)
  })
