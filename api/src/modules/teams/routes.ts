import { createRoute, z } from "@hono/zod-openapi"
import { Forbidden } from "../../core/errors"
import { requirePermission } from "../../core/middleware/permission"
import { subjectUserId } from "../../core/middleware/principal"
import { requireModule } from "../../core/middleware/module"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import { createTeam, deleteTeam, listPeople, listTeams, peopleAccess, resolveScope, setManager, setTeamMembers, updateTeam } from "./service"

const Id = z.uuid()
const UserId = z.string().min(1).max(128)
const Kind = z.enum(["team", "department"])
const Name = z.string().trim().min(1).max(80).regex(/^[^\r\n]+$/)
const Team = z.object({ id: z.string(), name: z.string(), kind: Kind, memberIds: z.array(z.string()) })
const Person = z.object({ userId: z.string(), name: z.string(), email: z.string(), roleKey: z.string(), managerId: z.string().nullable() })

const CreateBody = z.object({ name: Name, kind: Kind.default("team") }).openapi({ example: { name: "Night shift", kind: "team" } })
const PatchBody = z
  .object({ name: Name.optional(), kind: Kind.optional() })
  .refine((v) => v.name !== undefined || v.kind !== undefined)
  .openapi({ example: { name: "Late shift" } })
const MembersBody = z.object({ userIds: z.array(UserId).max(500) }).openapi({ example: { userIds: ["usr_123", "usr_456"] } })
const ManagerBody = z.object({ managerId: UserId.nullable() }).openapi({ example: { managerId: "usr_123" } })

const listRoute = createRoute({
  method: "get", path: "/v1/teams", middleware: [requireTenant] as const,
  request: { query: z.object({ member: UserId.optional(), kind: Kind.optional() }) },
  responses: { 200: { description: "Teams and departments of the tenant, optionally those a member belongs to", content: { "application/json": { schema: z.array(Team) } } } },
})
const createRouteDef = createRoute({
  method: "post", path: "/v1/teams", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { body: { content: { "application/json": { schema: CreateBody } }, required: true } },
  responses: { 201: { description: "Created team", content: { "application/json": { schema: Team } } } },
})
const patchRoute = createRoute({
  method: "patch", path: "/v1/teams/{id}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: PatchBody } }, required: true } },
  responses: { 200: { description: "Updated team", content: { "application/json": { schema: Team } } } },
})
const deleteRoute = createRoute({
  method: "delete", path: "/v1/teams/{id}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 204: { description: "Deleted" } },
})
const membersRoute = createRoute({
  method: "put", path: "/v1/teams/{id}/members", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: MembersBody } }, required: true } },
  responses: { 200: { description: "Team with its new member set", content: { "application/json": { schema: Team } } } },
})
const managerRoute = createRoute({
  method: "put", path: "/v1/members/{userId}/manager", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ userId: UserId }), body: { content: { "application/json": { schema: ManagerBody } }, required: true } },
  responses: { 200: { description: "The member's primary manager (null = none)", content: { "application/json": { schema: z.object({ userId: z.string(), managerId: z.string().nullable() }) } } } },
})
const peopleRoute = createRoute({
  method: "get", path: "/v1/people", middleware: [requireTenant, requireModule("M1"), requirePermission("reports", "read")] as const,
  request: { query: z.object({ scope: z.enum(["own", "team", "all"]).optional() }) },
  responses: { 200: { description: "People in the caller's report scope", content: { "application/json": { schema: z.array(Person) } } } },
})

export const teamRoutes = newRouter()
  .openapi(listRoute, async (c) => {
    const t = c.get("tenant")!
    const q = c.req.valid("query")
    return c.json(await withTenant(c.get("deps").db, t.id, (tx) => listTeams(tx, t.id, q)), 200)
  })
  .openapi(createRouteDef, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    return c.json(await withTenant(deps.db, t.id, (tx) => createTeam(tx, t.id, actor, c.req.valid("json"), deps.clock.now())), 201)
  })
  .openapi(patchRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    return c.json(await withTenant(deps.db, t.id, (tx) => updateTeam(tx, t.id, actor, c.req.valid("param").id, c.req.valid("json"), deps.clock.now())), 200)
  })
  .openapi(deleteRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    await withTenant(deps.db, t.id, (tx) => deleteTeam(tx, t.id, actor, c.req.valid("param").id, deps.clock.now()))
    return c.body(null, 204)
  })
  .openapi(membersRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    return c.json(await withTenant(deps.db, t.id, (tx) => setTeamMembers(tx, t.id, actor, c.req.valid("param").id, c.req.valid("json").userIds, deps.clock.now())), 200)
  })
  .openapi(managerRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    return c.json(await withTenant(deps.db, t.id, (tx) => setManager(tx, t.id, actor, c.req.valid("param").userId, c.req.valid("json").managerId, deps.clock.now())), 200)
  })
  .openapi(peopleRoute, async (c) => {
    const t = c.get("tenant")!
    // an API key sees what its CREATOR would (scope is resolved from the creator's role; the creator is the `person` for team/own scope)
    const me = subjectUserId(c)
    const role = c.get("role")! // loaded by requirePermission
    const rows = await withTenant(c.get("deps").db, t.id, async (tx) => {
      const scope = resolveScope(await peopleAccess(tx, t.id, role, me), c.req.valid("query").scope)
      if (scope === "forbidden") throw Forbidden("forbidden")
      return listPeople(tx, t.id, scope, me)
    })
    return c.json(rows, 200)
  })
