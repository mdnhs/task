import { createRoute, z } from "@hono/zod-openapi"
import { setDeviceCookie } from "../../core/middleware/device"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import { AppError } from "../../core/errors"
import { bindDevice, issueEnrolment, listDevices, listPolicies, registerDevice, retireDevice, setPolicy, updateDevice } from "./service"

const Id = z.uuid()
const Type = z.enum(["pc", "android", "browser"])
const Owner = z.enum(["company", "personal"])
const Feature = z.enum(["drive", "payroll"])
const Allow = z.enum(["trusted-company-pc", "any", "none"])
const Label = z.string().trim().min(2).max(60).regex(/^[^\r\n]+$/)
const Device = z.object({ id: z.string(), userId: z.string(), type: Type, owner: Owner, label: z.string(), trusted: z.boolean(), lastSeen: z.string().nullable() })
const Policy = z.object({ feature: Feature, allow: Allow })

const RegisterBody = z
  .object({ userId: z.string().min(1).max(128), type: Type, owner: Owner, label: Label, trusted: z.boolean().default(false) })
  .openapi({ example: { userId: "usr_123", type: "pc", owner: "company", label: "Front desk PC", trusted: true } })
const PatchBody = z
  .object({ type: Type.optional(), owner: Owner.optional(), label: Label.optional(), trusted: z.boolean().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined))
  .openapi({ example: { trusted: false } })
const BindBody = z.object({ code: z.string().max(64).optional() }).openapi({ example: { code: "ABCD2345JK" } })
const PolicyBody = z.object({ allow: Allow }).openapi({ example: { allow: "trusted-company-pc" } })

const listRoute = createRoute({
  method: "get", path: "/v1/devices", middleware: [requireTenant] as const,
  responses: { 200: { description: "All devices of the tenant for settings:write, otherwise only the caller's own", content: { "application/json": { schema: z.array(Device) } } } },
})
const registerRoute = createRoute({
  method: "post", path: "/v1/devices", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { body: { content: { "application/json": { schema: RegisterBody } }, required: true } },
  responses: { 201: { description: "Registered device", content: { "application/json": { schema: Device } } } },
})
const patchRoute = createRoute({
  method: "patch", path: "/v1/devices/{id}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: PatchBody } }, required: true } },
  responses: { 200: { description: "Updated device (takes effect on the device's next request)", content: { "application/json": { schema: Device } } } },
})
const retireRoute = createRoute({
  method: "delete", path: "/v1/devices/{id}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 204: { description: "Retired: the device and its binding are removed (audited device.retired); a browser that was bound to it is the unregistered browser from its next request. 404 device_not_found (also another tenant's id). Open to a read-only (blocked) tenant." } },
})
const bindRoute = createRoute({
  method: "post", path: "/v1/devices/{id}/bind", middleware: [requireTenant] as const,
  request: { params: z.object({ id: Id }), body: { content: { "application/json": { schema: BindBody } }, required: false } },
  responses: { 200: { description: "Device bound to this browser (signed HttpOnly per-tenant od-device cookie) with a valid one-time enrolment code; only the allocated user, only while unbound (409 device_already_bound), wrong/expired code 422 invalid_enrolment_code", content: { "application/json": { schema: Device } } } },
})
const enrolRoute = createRoute({
  method: "post", path: "/v1/devices/{id}/enrolment-code", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 201: { description: "One-time enrolment code (shown once, valid 15 minutes); also resets the device's current binding", content: { "application/json": { schema: z.object({ code: z.string(), expiresAt: z.string() }) } } } },
})
const listPoliciesRoute = createRoute({
  method: "get", path: "/v1/device-policies", middleware: [requireTenant] as const,
  responses: { 200: { description: "Effective policy per feature (no stored row = any)", content: { "application/json": { schema: z.array(Policy) } } } },
})
const putPolicyRoute = createRoute({
  method: "put", path: "/v1/device-policies/{feature}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ feature: Feature }), body: { content: { "application/json": { schema: PolicyBody } }, required: true } },
  responses: { 200: { description: "The policy now in force", content: { "application/json": { schema: Policy } } } },
})

export const deviceRoutes = newRouter()
  .openapi(listRoute, async (c) => {
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    return c.json(await withTenant(c.get("deps").db, t.id, (tx) => listDevices(tx, t.id, actor)), 200)
  })
  .openapi(registerRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    return c.json(await withTenant(deps.db, t.id, (tx) => registerDevice(tx, t.id, actor, c.req.valid("json"), deps.clock.now())), 201)
  })
  .openapi(patchRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    return c.json(await withTenant(deps.db, t.id, (tx) => updateDevice(tx, t.id, actor, c.req.valid("param").id, c.req.valid("json"), deps.clock.now())), 200)
  })
  .openapi(retireRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    await withTenant(deps.db, t.id, (tx) => retireDevice(tx, t.id, actor, c.req.valid("param").id, deps.clock.now()))
    return c.body(null, 204)
  })
  .openapi(enrolRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    return c.json(await withTenant(deps.db, t.id, (tx) => issueEnrolment(tx, t.id, actor, c.req.valid("param").id, deps.clock.now())), 201)
  })
  .openapi(bindRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    const body = c.req.valid("json") as { code?: string } | undefined
    const ua = c.req.header("user-agent") ?? ""
    const r = await withTenant(deps.db, t.id, (tx) => bindDevice(tx, t.id, actor, c.req.valid("param").id, body?.code ?? "", ua, deps.clock.now()))
    if (!r.ok) throw new AppError(422, "invalid_enrolment_code", "Unprocessable Entity")
    await setDeviceCookie(c, t.id, r.device.id, r.secret)
    return c.json(r.device, 200)
  })
  .openapi(listPoliciesRoute, async (c) => {
    const t = c.get("tenant")!
    return c.json(await withTenant(c.get("deps").db, t.id, (tx) => listPolicies(tx, t.id)), 200)
  })
  .openapi(putPolicyRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const actor = { userId: c.get("member")!.userId }
    return c.json(await withTenant(deps.db, t.id, (tx) => setPolicy(tx, t.id, actor, c.req.valid("param").feature, c.req.valid("json").allow, deps.clock.now())), 200)
  })
