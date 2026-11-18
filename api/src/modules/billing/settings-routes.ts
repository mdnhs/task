import { createRoute, z } from "@hono/zod-openapi"
import { requirePlatformStaff } from "../../core/middleware/platform"
import { newRouter } from "../../core/router"
import { getBillingSettings, setBillingSettings, type BillingSettings } from "./settings"

const Settings = z
  .union([
    z.object({ configured: z.literal(false) }),
    z.object({
      configured: z.literal(true), provider: z.literal("stripe"), secretKeyLast4: z.string(), webhookSecretLast4: z.string(), publishableKey: z.string().nullable(),
      priceMap: z.record(z.string(), z.string()), webhookUrl: z.string(), updatedAt: z.string(), updatedBy: z.string().nullable(),
    }),
  ])
  .openapi({
    example: {
      configured: true, provider: "stripe", secretKeyLast4: "ABCD", webhookSecretLast4: "wxyz", publishableKey: "pk_test_51ExamplePublishableKey",
      priceMap: { starter: "price_1StarterEx", business: "price_1BusinessEx" }, webhookUrl: "https://app.opsdesk.example/webhooks/billing/stripe",
      updatedAt: "2026-11-17T09:00:00.000Z", updatedBy: "usr_platform_owner",
    },
  })
const PutBody = z
  .object({
    secretKey: z.string().max(260).optional(), webhookSecret: z.string().max(260).optional(),
    publishableKey: z.string().max(260).nullable().optional(), priceMap: z.record(z.string(), z.string()).optional(),
  })
  .openapi({
    example: {
      secretKey: "sk_test_51ExampleSecretKeyAbCdEf1234567890", webhookSecret: "whsec_ExampleWebhookSigningSecret1234567890", // check-secrets:allow invented OpenAPI example, not a credential
      publishableKey: "pk_test_51ExamplePublishableKey", priceMap: { starter: "price_1StarterEx", business: "price_1BusinessEx" },
    },
  })

const roles = requirePlatformStaff("owner", "billing")
const getRoute = createRoute({
  method: "get", path: "/v1/platform/settings/billing", middleware: [roles] as const,
  responses: { 200: { description: "Platform billing settings; secrets are never returned, only their last 4", content: { "application/json": { schema: Settings } } } },
})
const putRoute = createRoute({
  method: "put", path: "/v1/platform/settings/billing", middleware: [roles] as const,
  request: { body: { content: { "application/json": { schema: PutBody } }, required: true } },
  responses: { 200: { description: "The stored settings (audited in the same transaction)", content: { "application/json": { schema: Settings } } } },
})

export const billingSettingsRoutes = newRouter()
  .openapi(getRoute, async (c) => c.json(view(await getBillingSettings(c.get("deps").db), c.get("deps").env.APP_URL), 200))
  .openapi(putRoute, async (c) => {
    const deps = c.get("deps")
    await setBillingSettings(deps.db, deps, c.req.valid("json"), c.get("staff")!.userId)
    return c.json(view(await getBillingSettings(deps.db), deps.env.APP_URL), 200)
  })

function view(s: BillingSettings, appUrl: string) {
  return s.configured ? { ...s, webhookUrl: `${appUrl}/webhooks/billing/stripe`, updatedAt: s.updatedAt.toISOString() } : s
}
