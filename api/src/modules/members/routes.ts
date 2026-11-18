import { createRoute, z } from "@hono/zod-openapi"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenantAfterCommit } from "../notifications"
import { deactivateMember, reactivateMember, revokeSessionsIfOrphaned } from "./service"

const UserParam = z.object({ userId: z.string().min(1).max(128) })
const StatusOut = z
  .object({ userId: z.string(), status: z.enum(["active", "deactivated"]), deactivatedAt: z.string().nullable() })
  .openapi({ example: { userId: "usr_8Kq2mZ4tW1", status: "deactivated", deactivatedAt: "2026-11-18T09:00:00.000Z" } })
const guard = [requireTenant, requirePermission("settings", "write")]

const deactivateR = createRoute({
  method: "post", path: "/v1/members/{userId}/deactivate", middleware: guard, request: { params: UserParam },
  responses: { 200: { description: "The member is deactivated (owner or admin: settings write): they cannot reach the workspace, keep their history and shifts, their open shift assignments end today and their pending roster requests are closed. Sessions are revoked when this was their last workspace. 404 member_not_found; 403 role_escalation (acting on a role above yours); 409 already_deactivated | last_owner (the last active owner, as the role-change and erasure guards); 422 self_deactivation", content: { "application/json": { schema: StatusOut } } } },
})
const reactivateR = createRoute({
  method: "post", path: "/v1/members/{userId}/reactivate", middleware: guard, request: { params: UserParam },
  responses: { 200: { description: "The member is active again (needs a free seat). 404 member_not_found; 403 role_escalation; 409 not_deactivated | seat_limit", content: { "application/json": { schema: StatusOut } } } },
})

export const memberLifecycleRoutes = newRouter()
  .openapi(deactivateR, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const userId = c.req.valid("param").userId
    const out = await withTenantAfterCommit(deps, t.id, (tx, enqueue) => deactivateMember(tx, { deps, enqueue }, { id: t.id, tz: t.timezone }, { userId: c.get("member")!.userId }, userId))
    await revokeSessionsIfOrphaned(deps, userId)
    return c.json(out, 200)
  })
  .openapi(reactivateR, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    return c.json(await withTenantAfterCommit(deps, t.id, (tx, enqueue) => reactivateMember(tx, { deps, enqueue }, { id: t.id }, { userId: c.get("member")!.userId }, c.req.valid("param").userId)), 200)
  })
