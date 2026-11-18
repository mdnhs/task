import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { Forbidden } from "../../core/errors"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { createEndpoint, deleteEndpoint, listEndpoints, updateEndpoint, type EndpointView } from "./service"

const WID = "3b9f2c71-4d8e-4a15-9c06-7e1d5a2b8f40"
const NOW = "2026-11-17T09:00:00.000Z"
const URL_EX = "https://hooks.example.com/opsdesk"

const Endpoint = z.object({ id: z.string(), url: z.string(), events: z.array(z.string()), active: z.boolean(), createdBy: z.string(), createdAt: z.string(), failingSince: z.string().nullable() })
const EndpointExample = { id: WID, url: URL_EX, events: ["team.created", "file.uploaded"], active: true, createdBy: "usr_8Kq2mZ4tW1", createdAt: NOW, failingSince: null }
const EndpointDto = Endpoint.openapi({ example: EndpointExample })
const Created = Endpoint.extend({ secret: z.string() }).openapi({ example: { ...EndpointExample, secret: "whsec_Zm9yX2tL0pQ7rS4uV6wY8aB1cD3eF5gH7iJ9kL2mN4o" } }) // check-secrets:allow invented OpenAPI example, not a credential
const EndpointList = z.object({ items: z.array(Endpoint) }).openapi({ example: { items: [EndpointExample] } })
// url / events are checked by the service (422 invalid_webhook_url | unsafe_webhook_url | invalid_events), not by zod (which would answer 400).
const CreateBody = z.object({
  url: z.unknown().optional().openapi({ description: "https only, at most 2048 characters, no userinfo, port 443 or 1024-65535, every resolved address public", example: URL_EX }),
  events: z.unknown().optional().openapi({ description: "Subset of the allow-list of event types (see WEBHOOK_EVENT_TYPES)", example: ["team.created", "file.uploaded"] }),
}).openapi({ example: { url: URL_EX, events: ["team.created", "file.uploaded"] } })
const PatchBody = z
  .object({ url: z.unknown().optional(), events: z.unknown().optional(), active: z.boolean().optional() })
  .refine((v) => v.url !== undefined || v.events !== undefined || v.active !== undefined)
  .openapi({ example: { events: ["team.created"], active: true } })
const IdParam = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: WID }) })

const createR = createRoute({
  method: "post", path: "/v1/webhooks", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { body: { content: { "application/json": { schema: CreateBody } }, required: true } },
  responses: { 201: { description: "The endpoint with its signing secret, shown ONCE. Deliveries carry `X-OpsDesk-Signature: t=<unix ts>,v1=<hex hmac_sha256(secret, \"<ts>.<body>\")>`. 409 webhook_limit (10 per tenant), 422 invalid_webhook_url | unsafe_webhook_url | invalid_events", content: { "application/json": { schema: Created } } } },
})
const listR = createRoute({
  method: "get", path: "/v1/webhooks", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  responses: { 200: { description: "The tenant's endpoints (never the secret)", content: { "application/json": { schema: EndpointList } } } },
})
const patchR = createRoute({
  method: "patch", path: "/v1/webhooks/{id}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: IdParam, body: { content: { "application/json": { schema: PatchBody } }, required: true } },
  responses: { 200: { description: "Updated endpoint (a changed URL is re-checked; `active: true` resumes a disabled endpoint). 404 webhook_not_found, 422 invalid_webhook_url | unsafe_webhook_url | invalid_events", content: { "application/json": { schema: EndpointDto } } } },
})
const deleteR = createRoute({
  method: "delete", path: "/v1/webhooks/{id}", middleware: [requireTenant, requirePermission("settings", "write")] as const, request: { params: IdParam },
  responses: { 204: { description: "Deleted (the secret is destroyed). 404 webhook_not_found" } },
})

/** Defence in depth behind the deny-list: only humans (not keys, not support sessions) manage webhooks. */
const humanOnly = (c: Context<AppEnv>) => {
  if (c.get("apiKey") || c.get("support")) throw Forbidden("api_key_forbidden_route")
}
const iso = (e: EndpointView) => ({ ...e, createdAt: e.createdAt.toISOString(), failingSince: e.failingSince?.toISOString() ?? null })

export const webhookRoutes = newRouter()
  .openapi(createR, async (c) => {
    humanOnly(c)
    const out = await createEndpoint(c.get("deps"), c.get("tenant")!.id, c.get("member")!.userId, c.req.valid("json"))
    return c.json({ ...iso(out.view), secret: out.secret }, 201)
  })
  .openapi(listR, async (c) => {
    humanOnly(c)
    return c.json({ items: (await listEndpoints(c.get("deps"), c.get("tenant")!.id)).map(iso) }, 200)
  })
  .openapi(patchR, async (c) => {
    humanOnly(c)
    return c.json(iso(await updateEndpoint(c.get("deps"), c.get("tenant")!.id, c.get("member")!.userId, c.req.valid("param").id, c.req.valid("json"))), 200)
  })
  .openapi(deleteR, async (c) => {
    humanOnly(c)
    await deleteEndpoint(c.get("deps"), c.get("tenant")!.id, c.get("member")!.userId, c.req.valid("param").id)
    return c.body(null, 204)
  })
