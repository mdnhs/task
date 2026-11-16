import { createRoute, z } from "@hono/zod-openapi"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import { KINDS } from "./prefs"
import { addPushToken, getPreferences, listNotifications, markAllRead, markRead, removePushToken, setPreferences } from "./service"

const Kind = z.enum(KINDS)
const Id = z.uuid()
const Notification = z.object({ id: z.string(), kind: Kind, title: z.string(), body: z.string(), link: z.string().nullable(), createdAt: z.string(), readAt: z.string().nullable() })
const Channel = z.object({ inApp: z.boolean(), email: z.boolean(), push: z.boolean() })
const Prefs = z.object({ channels: z.record(Kind, Channel), quietStart: z.string().nullable(), quietEnd: z.string().nullable() })
const ChannelPatch = z.object({ inApp: z.boolean().optional(), email: z.boolean().optional(), push: z.boolean().optional() })
const PrefsBody = z
  .object({ channels: z.partialRecord(Kind, ChannelPatch), quietStart: z.string().nullable(), quietEnd: z.string().nullable() })
  .openapi({ example: { channels: { system: { email: true }, member: { push: false } }, quietStart: "22:00", quietEnd: "07:00" } })
const TokenBody = z.object({ token: z.string().min(8).max(4096), platform: z.enum(["android"]).default("android") }).openapi({ example: { token: "fcm-registration-token-abc123", platform: "android" } })
const Token = z.object({ id: z.string(), platform: z.enum(["android"]), createdAt: z.string() })

const listRoute = createRoute({
  method: "get", path: "/v1/notifications", middleware: [requireTenant] as const,
  request: { query: z.object({ unread: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }) },
  responses: { 200: { description: "The caller's own in-app notifications, newest first, with their unread count", content: { "application/json": { schema: z.object({ items: z.array(Notification), unread: z.number() }) } } } },
})
const readAllRoute = createRoute({
  method: "post", path: "/v1/notifications/read-all", middleware: [requireTenant] as const,
  responses: { 200: { description: "Marks all of the caller's notifications read", content: { "application/json": { schema: z.object({ updated: z.number() }) } } } },
})
const readRoute = createRoute({
  method: "post", path: "/v1/notifications/{id}/read", middleware: [requireTenant] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 200: { description: "The notification, marked read. Another user's or tenant's id is 404 notification_not_found", content: { "application/json": { schema: Notification } } } },
})
const getPrefsRoute = createRoute({
  method: "get", path: "/v1/me/notification-preferences", middleware: [requireTenant] as const,
  responses: { 200: { description: "Effective channel matrix per kind plus quiet hours (tenant-local HH:MM)", content: { "application/json": { schema: Prefs } } } },
})
const putPrefsRoute = createRoute({
  method: "put", path: "/v1/me/notification-preferences", middleware: [requireTenant] as const,
  request: { body: { content: { "application/json": { schema: PrefsBody } }, required: true } },
  responses: { 200: { description: "Saved. Quiet hours: both null or both HH:MM and different, else 422 invalid_quiet_hours. security always keeps in-app and email", content: { "application/json": { schema: Prefs } } } },
})
const addTokenRoute = createRoute({
  method: "post", path: "/v1/me/push-tokens", middleware: [requireTenant] as const,
  request: { body: { content: { "application/json": { schema: TokenBody } }, required: true } },
  responses: { 201: { description: "Token stored sealed; the raw token is never returned. Re-registering the same token returns the same id", content: { "application/json": { schema: Token } } } },
})
const delTokenRoute = createRoute({
  method: "delete", path: "/v1/me/push-tokens/{id}", middleware: [requireTenant] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 204: { description: "Removed. Another user's or tenant's id is 404 push_token_not_found" } },
})

export const notificationRoutes = newRouter()
  .openapi(listRoute, async (c) => {
    const t = c.get("tenant")!
    const q = c.req.valid("query")
    return c.json(await withTenant(c.get("deps").db, t.id, (tx) => listNotifications(tx, t.id, c.get("member")!.userId, { unreadOnly: q.unread === "true", limit: q.limit })), 200)
  })
  .openapi(readAllRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    return c.json({ updated: await withTenant(deps.db, t.id, (tx) => markAllRead(tx, t.id, c.get("member")!.userId, deps.clock.now())) }, 200)
  })
  .openapi(readRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    return c.json(await withTenant(deps.db, t.id, (tx) => markRead(tx, t.id, c.get("member")!.userId, c.req.valid("param").id, deps.clock.now())), 200)
  })
  .openapi(getPrefsRoute, async (c) => {
    const t = c.get("tenant")!
    return c.json(await withTenant(c.get("deps").db, t.id, (tx) => getPreferences(tx, t.id, c.get("member")!.userId)), 200)
  })
  .openapi(putPrefsRoute, async (c) => {
    const t = c.get("tenant")!
    const body = c.req.valid("json")
    return c.json(await withTenant(c.get("deps").db, t.id, (tx) => setPreferences(tx, t.id, c.get("member")!.userId, body)), 200)
  })
  .openapi(addTokenRoute, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const body = c.req.valid("json")
    return c.json(await withTenant(deps.db, t.id, (tx) => addPushToken(tx, t.id, c.get("member")!.userId, body.token, body.platform, deps)), 201)
  })
  .openapi(delTokenRoute, async (c) => {
    const t = c.get("tenant")!
    await withTenant(c.get("deps").db, t.id, (tx) => removePushToken(tx, t.id, c.get("member")!.userId, c.req.valid("param").id))
    return c.body(null, 204)
  })
