import { createRoute, z } from "@hono/zod-openapi"
import { requirePlatformStaff } from "../../core/middleware/platform"
import { newRouter } from "../../core/router"
import { getEmailSettings, sendTestEmail, setEmailSettings, type EmailSettings } from "./service"


const Settings = z.union([
  z.object({ configured: z.literal(false) }),
  z.object({ configured: z.literal(true), provider: z.literal("resend"), fromAddress: z.string(), fromName: z.string(), keyLast4: z.string(), updatedAt: z.string(), updatedBy: z.string().nullable() }),
])
const PutBody = z
  .object({ apiKey: z.string().max(200).optional(), fromAddress: z.string().max(320), fromName: z.string().max(200) })
  .openapi({ example: { apiKey: "re_AbCdEf1234567890abcdef", fromAddress: "no-reply@opsdesk.example", fromName: "OpsDesk" } })
const TestBody = z.object({ to: z.string().max(320) }).openapi({ example: { to: "ops@opsdesk.example" } })
const TestResult = z.union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: z.string() })])

const view = (s: EmailSettings) => (s.configured ? { ...s, updatedAt: s.updatedAt.toISOString() } : s)

const getRoute = createRoute({
  method: "get", path: "/v1/platform/settings/email", middleware: [requirePlatformStaff("owner")] as const,
  responses: { 200: { description: "Platform email settings; the key is never returned, only its last 4", content: { "application/json": { schema: Settings } } } },
})
const putRoute = createRoute({
  method: "put", path: "/v1/platform/settings/email", middleware: [requirePlatformStaff("owner")] as const,
  request: { body: { content: { "application/json": { schema: PutBody } }, required: true } },
  responses: { 200: { description: "The stored settings (audited in the same transaction)", content: { "application/json": { schema: Settings } } } },
})
const testRoute = createRoute({
  method: "post", path: "/v1/platform/settings/email/test", middleware: [requirePlatformStaff("owner")] as const,
  request: { body: { content: { "application/json": { schema: TestBody } }, required: true } },
  responses: { 200: { description: "Result of a test send with the stored settings", content: { "application/json": { schema: TestResult } } } },
})

export const emailSettingsRoutes = newRouter()
  .openapi(getRoute, async (c) => c.json(view(await getEmailSettings(c.get("deps").db)), 200))
  .openapi(putRoute, async (c) => {
    const deps = c.get("deps")
    await setEmailSettings(deps.db, deps, c.req.valid("json"), c.get("staff")!.userId)
    return c.json(view(await getEmailSettings(deps.db)), 200)
  })
  .openapi(testRoute, async (c) => c.json(await sendTestEmail(c.get("deps"), c.req.valid("json").to), 200))
