import { createRoute, z } from "@hono/zod-openapi"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant } from "../../db/tenant-tx"
import { entitlementsFor, seatsUsed } from "./service"

const EntitlementsDto = z
  .object({
    planId: z.string(),
    status: z.enum(["trialing", "active", "past_due", "canceled", "incomplete"]),
    modules: z.array(z.string()).openapi({ description: "Product module ids the tenant may use (plan plus overrides)" }),
    seats: z.number().int(),
    seatsUsed: z.number().int(),
    trialEndsAt: z.string().nullable(),
    graceEndsAt: z.string().nullable().openapi({ description: "Trial end + 7 days: writes are allowed until then, then billing_required (402)" }),
    billingState: z.enum(["ok", "grace", "blocked"]),
  })
  .openapi({
    example: { planId: "starter", status: "trialing", modules: ["M0", "M1"], seats: 10, seatsUsed: 3, trialEndsAt: "2026-12-01T00:00:00.000Z", graceEndsAt: "2026-12-08T00:00:00.000Z", billingState: "ok" },
  })

const getRoute = createRoute({
  method: "get",
  path: "/v1/entitlements",
  middleware: [requireTenant] as const,
  responses: { 200: { description: "The tenant's plan, status, product modules and seats (any member; cached <= 60 s)", content: { "application/json": { schema: EntitlementsDto } } } },
})

export const entitlementRoutes = newRouter().openapi(getRoute, async (c) => {
  const deps = c.get("deps")
  const t = c.get("tenant")!
  const ent = await entitlementsFor(deps, t.id)
  const used = await withTenant(deps.db, t.id, (tx) => seatsUsed(tx, t.id))
  return c.json(
    {
      planId: ent.planId, status: ent.status, modules: ent.allowed, seats: ent.seats, seatsUsed: used,
      trialEndsAt: ent.trialEndsAt?.toISOString() ?? null, graceEndsAt: ent.graceEndsAt?.toISOString() ?? null, billingState: ent.billingState,
    },
    200,
  )
})
