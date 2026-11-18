import { createRoute, z } from "@hono/zod-openapi"
import { requirePlatformStaff } from "../../core/middleware/platform"
import { newRouter } from "../../core/router"
import { addStaff, listStaff, PLATFORM_ROLES, updateStaff } from "./service"


const Role = z.enum(PLATFORM_ROLES)
const Member = z.object({ userId: z.string(), name: z.string(), email: z.string(), role: Role, status: z.enum(["active", "suspended"]), twoFactorEnabled: z.boolean(), addedBy: z.string(), addedAt: z.string() })
const AddBody = z.object({ email: z.string().max(320), role: Role }).openapi({ example: { email: "priya.shah@opsdesk.example", role: "support" } })
const PatchBody = z
  .object({ role: Role.optional(), status: z.enum(["active", "suspended"]).optional() })
  .refine((b) => b.role !== undefined || b.status !== undefined)
  .openapi({ example: { role: "billing" } })
const Param = z.object({ userId: z.string().min(1).max(64).openapi({ param: { name: "userId", in: "path" }, example: "usr_01H8XYZ" }) })

const SessionProbe = z.object({ staff: z.literal(true), role: Role, mfa: z.literal("ok") }).openapi({ example: { staff: true, role: "support", mfa: "ok" } })
const sessionRoute = createRoute({
  method: "get", path: "/v1/platform/session", middleware: [requirePlatformStaff(...PLATFORM_ROLES)] as const,
  responses: { 200: { description: "Cheap console probe: the caller is active staff and this session passed its second factor. One indexed staff lookup, no tenant query. 401 mfa_challenge | mfa_enrolment_required, 404 not_found for everyone who is not active staff", content: { "application/json": { schema: SessionProbe } } } },
})
const listRoute = createRoute({
  method: "get", path: "/v1/platform/staff", middleware: [requirePlatformStaff("owner")] as const,
  responses: { 200: { description: "Platform staff", content: { "application/json": { schema: z.array(Member) } } } },
})
const addRoute = createRoute({
  method: "post", path: "/v1/platform/staff", middleware: [requirePlatformStaff("owner")] as const,
  request: { body: { content: { "application/json": { schema: AddBody } }, required: true } },
  responses: { 201: { description: "Added (an existing, non-erased user; 2FA is enforced at every request, not here)", content: { "application/json": { schema: z.object({ userId: z.string() }) } } } },
})
const patchRoute = createRoute({
  method: "patch", path: "/v1/platform/staff/{userId}", middleware: [requirePlatformStaff("owner")] as const,
  request: { params: Param, body: { content: { "application/json": { schema: PatchBody } }, required: true } },
  responses: { 200: { description: "Updated; the last active owner cannot be demoted or suspended (409 last_platform_owner)", content: { "application/json": { schema: z.object({ ok: z.literal(true) }) } } } },
})

export const platformStaffRoutes = newRouter()
  .openapi(sessionRoute, (c) => c.json({ staff: true as const, role: c.get("staff")!.role, mfa: "ok" as const }, 200))
  .openapi(listRoute, async (c) => {
    const rows = await listStaff(c.get("deps").db)
    return c.json(rows.map((r) => ({ ...r, addedAt: r.addedAt.toISOString() })), 200)
  })
  .openapi(addRoute, async (c) => {
    const deps = c.get("deps")
    const r = await addStaff(deps.db, deps.clock.now(), c.get("staff")!.userId, c.req.valid("json"))
    return c.json(r, 201)
  })
  .openapi(patchRoute, async (c) => {
    const deps = c.get("deps")
    await updateStaff(deps.db, deps.clock.now(), c.get("staff")!.userId, c.req.valid("param").userId, c.req.valid("json"))
    return c.json({ ok: true as const }, 200)
  })
