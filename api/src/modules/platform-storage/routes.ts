import { createRoute, z } from "@hono/zod-openapi"
import { requirePlatformStaff } from "../../core/middleware/platform"
import { newRouter } from "../../core/router"
import { getStorageSettings, setStorageSettings, testStorage, type StorageSettings } from "./service"


const Settings = z.union([
  z.object({ configured: z.literal(false) }),
  z.object({ configured: z.literal(true), provider: z.literal("r2"), accountId: z.string(), bucket: z.string(), accessKeyId: z.string(), secretLast4: z.string(), updatedAt: z.string(), updatedBy: z.string().nullable() }),
])
const PutBody = z
  .object({ accountId: z.string().max(64), bucket: z.string().max(100), accessKeyId: z.string().max(200), secretAccessKey: z.string().max(200).optional() })
  .openapi({ example: { accountId: "0123456789abcdef0123456789abcdef", bucket: "opsdesk-files", accessKeyId: "AKIAR2EXAMPLEKEY0001", secretAccessKey: "r2-secret-access-key-ABCDEFGHIJKLMNOP9876" } }) // check-secrets:allow invented OpenAPI example, not a credential
const TestResult = z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: z.string() })])

const view = (s: StorageSettings) => (s.configured ? { ...s, updatedAt: s.updatedAt.toISOString() } : s)

const getRoute = createRoute({
  method: "get", path: "/v1/platform/settings/storage", middleware: [requirePlatformStaff("owner")] as const,
  responses: { 200: { description: "Platform R2 storage settings; the secret is never returned, only its last 4", content: { "application/json": { schema: Settings } } } },
})
const putRoute = createRoute({
  method: "put", path: "/v1/platform/settings/storage", middleware: [requirePlatformStaff("owner")] as const,
  request: { body: { content: { "application/json": { schema: PutBody } }, required: true } },
  responses: { 200: { description: "The stored settings (audited in the same transaction)", content: { "application/json": { schema: Settings } } } },
})
const testRoute = createRoute({
  method: "post", path: "/v1/platform/settings/storage/test", middleware: [requirePlatformStaff("owner")] as const,
  responses: { 200: { description: "Result of a put+delete probe against the stored bucket", content: { "application/json": { schema: TestResult } } } },
})

export const storageSettingsRoutes = newRouter()
  .openapi(getRoute, async (c) => c.json(view(await getStorageSettings(c.get("deps").db)), 200))
  .openapi(putRoute, async (c) => {
    const deps = c.get("deps")
    await setStorageSettings(deps.db, deps, c.req.valid("json"), c.get("staff")!.userId)
    return c.json(view(await getStorageSettings(deps.db)), 200)
  })
  .openapi(testRoute, async (c) => c.json(await testStorage(c.get("deps")), 200))
