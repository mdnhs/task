import { createRoute, z } from "@hono/zod-openapi"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import { DSR_KINDS, DSR_STATUSES } from "../../db/schema"
import { completeCorrection, createRequest, getRequest, listRequests, MAX_LIST, rejectRequest, retryRequest } from "./service"

const Id = z.uuid()
const Kind = z.enum(DSR_KINDS)
const Status = z.enum(DSR_STATUSES)
const Text = z.string().trim().min(1).max(2000)

const RequestDto = z
  .object({
    id: z.string(), subjectUserId: z.string(), kind: Kind, status: Status, requestedBy: z.string(), reason: z.string(),
    createdAt: z.string(), dueAt: z.string(), overdue: z.boolean(), startedAt: z.string().nullable(), completedAt: z.string().nullable(),
    resultFileId: z.string().nullable(), errorCode: z.string().nullable(), notes: z.string().nullable(),
  })
  .openapi("DataRequest", {
    example: {
      id: "5f1c1c5e-2d1b-4c51-9a1e-0f0e8f0e8f0e", subjectUserId: "usr_123", kind: "export", status: "pending", requestedBy: "usr_456", reason: "Subject access request received by email",
      createdAt: "2026-11-17T09:00:00.000Z", dueAt: "2026-12-17T09:00:00.000Z", overdue: false, startedAt: null, completedAt: null, resultFileId: null, errorCode: null, notes: null,
    },
  })

const CreateBody = z
  .object({ subjectUserId: z.string().min(1).max(128), kind: Kind, reason: Text })
  .openapi({ example: { subjectUserId: "usr_123", kind: "export", reason: "Subject access request received by email" } })
const CompleteBody = z.object({ notes: Text.optional() }).openapi({ example: { notes: "Surname corrected in the staff record" } })
const RejectBody = z.object({ notes: Text }).openapi({ example: { notes: "Identity of the requester could not be verified" } })

const createRouteDef = createRoute({
  method: "post", path: "/v1/data-requests", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { body: { content: { "application/json": { schema: CreateBody } }, required: true } },
  responses: { 201: { description: "Request opened; due 30 days later in tenant time. Export/erase run as background jobs. 404 member_not_found, 409 last_owner|request_open, 422 self_request_not_allowed (erase/correct of yourself)", content: { "application/json": { schema: RequestDto } } } },
})
const listRoute = createRoute({
  method: "get", path: "/v1/data-requests", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { query: z.object({ status: Status.optional(), limit: z.coerce.number().int().min(1).max(MAX_LIST).optional() }) },
  responses: { 200: { description: "Overdue open requests first (earliest due first), then other open ones, then finished ones", content: { "application/json": { schema: z.array(RequestDto) } } } },
})
const getRouteDef = createRoute({
  method: "get", path: "/v1/data-requests/{id}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 200: { description: "One request. Another tenant's or unknown id is 404 data_request_not_found", content: { "application/json": { schema: RequestDto } } } },
})
const completeRoute = createRoute({
  method: "post", path: "/v1/data-requests/{id}/complete", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: CompleteBody } }, required: true } },
  responses: { 200: { description: "A pending `correct` request closed after the data was edited by hand. 409 not_a_correction|request_closed", content: { "application/json": { schema: RequestDto } } } },
})
const rejectRoute = createRoute({
  method: "post", path: "/v1/data-requests/{id}/reject", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: RejectBody } }, required: true } },
  responses: { 200: { description: "A pending or failed request turned down; the reason is stored in notes. 409 request_closed", content: { "application/json": { schema: RequestDto } } } },
})
const retryRouteDef = createRoute({
  method: "post", path: "/v1/data-requests/{id}/retry", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 200: { description: "A failed export/erase put back to pending and queued again (audited dsr.retried). 409 request_not_failed", content: { "application/json": { schema: RequestDto } } } },
})
const meCreateRoute = createRoute({
  method: "post", path: "/v1/me/data-export", middleware: [requireTenant] as const,
  responses: { 201: { description: "Self-service: opens an export request for the caller (any active member). The requester downloads the finished file from /v1/files/{resultFileId}/download. 409 request_open", content: { "application/json": { schema: RequestDto } } } },
})
const meListRoute = createRoute({
  method: "get", path: "/v1/me/data-export", middleware: [requireTenant] as const,
  responses: { 200: { description: "The caller's own export requests (status, due date, result file id), newest open first", content: { "application/json": { schema: z.array(RequestDto) } } } },
})

export const gdprRoutes = newRouter()
  .openapi(createRouteDef, async (c) => {
    const t = c.get("tenant")!
    return c.json(await createRequest(c.get("deps"), t.id, { userId: c.get("member")!.userId }, c.req.valid("json")), 201)
  })
  .openapi(listRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const q = c.req.valid("query")
    return c.json(await withTenant(deps.db, t.id, (tx) => listRequests(tx, t.id, deps.clock.now(), q)), 200)
  })
  .openapi(getRouteDef, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    return c.json(await withTenant(deps.db, t.id, (tx) => getRequest(tx, t.id, c.req.valid("param").id, deps.clock.now())), 200)
  })
  .openapi(completeRoute, async (c) => {
    const t = c.get("tenant")!
    return c.json(await completeCorrection(c.get("deps"), t.id, { userId: c.get("member")!.userId }, c.req.valid("param").id, c.req.valid("json").notes), 200)
  })
  .openapi(rejectRoute, async (c) => {
    const t = c.get("tenant")!
    return c.json(await rejectRequest(c.get("deps"), t.id, { userId: c.get("member")!.userId }, c.req.valid("param").id, c.req.valid("json").notes), 200)
  })
  .openapi(retryRouteDef, async (c) => {
    const t = c.get("tenant")!
    return c.json(await retryRequest(c.get("deps"), t.id, { userId: c.get("member")!.userId }, c.req.valid("param").id), 200)
  })
  .openapi(meCreateRoute, async (c) => {
    const t = c.get("tenant")!
    const me = c.get("member")!.userId
    return c.json(await createRequest(c.get("deps"), t.id, { userId: me }, { subjectUserId: me, kind: "export", reason: "Self-service export request" }, { self: true }), 201)
  })
  .openapi(meListRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const me = c.get("member")!.userId
    return c.json(await withTenant(deps.db, t.id, (tx) => listRequests(tx, t.id, deps.clock.now(), { subjectUserId: me, requestedBy: me })), 200)
  })
