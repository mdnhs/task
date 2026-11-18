import { createRoute, z } from "@hono/zod-openapi"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import { AccessPatch, FieldRules } from "./access"
import { changeMemberRole, cloneRole, listRoles, toRoleDto, updateRole } from "./service"

const Id = z.uuid()
export const RoleDto = z.object({
  id: z.string(), key: z.string(), label: z.string(), description: z.string(), home: z.string(),
  access: z.record(z.string(), z.enum(["none", "read", "write"])), fieldRules: z.record(z.string(), z.array(z.string())),
  rosterLevel: z.enum(["office", "supervisor"]).nullable(),
  isTemplate: z.boolean(), clonedFrom: z.string().nullable(),
})
const Clone = z.object({ label: z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/) }).openapi({ example: { label: "Night lead" } })
const Patch = z
  .object({ label: z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/).optional(), access: AccessPatch.optional(), fieldRules: FieldRules.optional(), rosterLevel: z.enum(["office", "supervisor"]).nullable().optional() })
  .refine((v) => v.label !== undefined || v.access !== undefined || v.fieldRules !== undefined || v.rosterLevel !== undefined)
  .openapi({ example: { label: "Night lead", access: { payroll: "none" }, fieldRules: { member: ["payRate"] }, rosterLevel: "supervisor" } })
const MemberPatch = z.object({ roleId: Id }).openapi({ example: { roleId: "00000000-0000-4000-8000-000000000000" } })

const listRoute = createRoute({
  method: "get", path: "/v1/roles", middleware: [requireTenant, requirePermission("settings", "read")] as const,
  responses: { 200: { description: "Roles of the tenant", content: { "application/json": { schema: z.array(RoleDto) } } } },
})
const cloneRoute = createRoute({
  method: "post", path: "/v1/roles/{id}/clone", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: Clone } }, required: true } },
  responses: { 201: { description: "Editable copy of the role (access, field rules and roster level are copied; 403 role_escalation when the source has a roster level above the caller's own)", content: { "application/json": { schema: RoleDto } } } },
})
const patchRoute = createRoute({
  method: "patch", path: "/v1/roles/{id}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: Patch } }, required: true } },
  responses: { 200: { description: "Updated role. `rosterLevel` (office | supervisor | null) is the roster level of the role; a caller cannot grant a level above their own, nor re-level a role that outranks them (403 role_escalation)", content: { "application/json": { schema: RoleDto } } } },
})
const memberRoute = createRoute({
  method: "patch", path: "/v1/members/{userId}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ userId: z.string().min(1).max(128) }), body: { content: { "application/json": { schema: MemberPatch } }, required: true } },
  responses: { 200: { description: "Member with the new role", content: { "application/json": { schema: z.object({ userId: z.string(), roleId: z.string(), roleKey: z.string() }) } } } },
})

export const rbacRoutes = newRouter()
  .openapi(listRoute, async (c) => {
    const t = c.get("tenant")!
    const rows = await withTenant(c.get("deps").db, t.id, (tx) => listRoles(tx, t.id))
    return c.json(rows.map(toRoleDto), 200)
  })
  .openapi(cloneRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    const row = await withTenant(deps.db, t.id, (tx) => cloneRole(tx, t.id, actor, c.req.valid("param").id, c.req.valid("json").label, deps.clock.now()))
    return c.json(toRoleDto(row), 201)
  })
  .openapi(patchRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    const row = await withTenant(deps.db, t.id, (tx) => updateRole(tx, t.id, actor, c.req.valid("param").id, c.req.valid("json") as never, deps.clock.now()))
    return c.json(toRoleDto(row), 200)
  })
  .openapi(memberRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    const out = await withTenant(deps.db, t.id, (tx) => changeMemberRole(tx, t.id, actor, c.req.valid("param").userId, c.req.valid("json").roleId, deps.clock.now()))
    return c.json(out, 200)
  })
