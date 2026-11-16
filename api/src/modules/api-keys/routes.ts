import { createRoute, z } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { Forbidden } from "../../core/errors"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { loadRoleAccess } from "./actor"
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyView } from "./service"

const KID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const NOW = "2026-11-17T09:00:00.000Z"
const KEY_EXAMPLE = "odk_Ab3dE5gH_Zm9yX2tL0pQ7rS4uV6wY8aB1cD3eF5gH7iJ"

const Key = z.object({
  id: z.string(), name: z.string(), prefix: z.string(), scopes: z.array(z.string()), createdBy: z.string(),
  createdAt: z.string(), lastUsedAt: z.string().nullable(), revokedAt: z.string().nullable(),
})
const KeyExample = { id: KID, name: "CI export", prefix: "Ab3dE5gH", scopes: ["tasks:read", "settings:write"], createdBy: "usr_8Kq2mZ4tW1", createdAt: NOW, lastUsedAt: null, revokedAt: null }
const KeyDto = Key.openapi({ example: KeyExample })
const Created = Key.extend({ key: z.string() }).openapi({ example: { ...KeyExample, key: KEY_EXAMPLE } })
const KeyList = z.object({ items: z.array(Key) }).openapi({ example: { items: [{ ...KeyExample, lastUsedAt: NOW }] } })
// name / scopes are checked by the service (422 invalid_name | invalid_scope | scope_exceeds_role), not by zod (which would answer 400).
const CreateBody = z.object({
  name: z.unknown().optional().openapi({ description: "1..100 characters", example: "CI export" }),
  scopes: z.unknown().optional().openapi({ description: "`<module>:read|write`, each a subset of the creator's current role", example: ["tasks:read", "settings:write"] }),
}).openapi({ example: { name: "CI export", scopes: ["tasks:read", "settings:write"] } })
const IdParam = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: KID }) })

const createR = createRoute({
  method: "post", path: "/v1/api-keys", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { body: { content: { "application/json": { schema: CreateBody } }, required: true } },
  responses: { 201: { description: "The key, shown ONCE (`odk_<prefix>_<secret>`; only its sha256 is stored). Audited. 422 invalid_name | invalid_scope | scope_exceeds_role", content: { "application/json": { schema: Created } } } },
})
const listR = createRoute({
  method: "get", path: "/v1/api-keys", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  responses: { 200: { description: "The tenant's keys, newest first (never the key or its hash)", content: { "application/json": { schema: KeyList } } } },
})
const revokeR = createRoute({
  method: "delete", path: "/v1/api-keys/{id}", middleware: [requireTenant, requirePermission("settings", "write")] as const, request: { params: IdParam },
  responses: { 200: { description: "Revoked: the key answers 401 invalid_api_key from now on. 404 api_key_not_found, 409 api_key_revoked", content: { "application/json": { schema: KeyDto } } } },
})

/** Defence in depth behind the deny-list: only humans (not keys, not support sessions) manage keys. */
const humanOnly = (c: Context<AppEnv>) => {
  if (c.get("apiKey") || c.get("support")) throw Forbidden("api_key_forbidden_route")
}
const iso = (k: ApiKeyView) => ({ ...k, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null })

export const apiKeyRoutes = newRouter()
  .openapi(createR, async (c) => {
    humanOnly(c)
    const t = c.get("tenant")!
    const userId = c.get("member")!.userId
    const out = await createApiKey(c.get("deps"), t.id, { userId, access: await loadRoleAccess(c) }, c.req.valid("json"))
    return c.json({ ...iso(out.view), key: out.key }, 201)
  })
  .openapi(listR, async (c) => {
    humanOnly(c)
    return c.json({ items: (await listApiKeys(c.get("deps"), c.get("tenant")!.id)).map(iso) }, 200)
  })
  .openapi(revokeR, async (c) => {
    humanOnly(c)
    return c.json(iso(await revokeApiKey(c.get("deps"), c.get("tenant")!.id, c.get("member")!.userId, c.req.valid("param").id)), 200)
  })
