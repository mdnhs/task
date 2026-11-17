import { createRoute, z } from "@hono/zod-openapi"
import { eq } from "drizzle-orm"
import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../../core/context"
import { Forbidden } from "../../core/errors"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { tenants } from "../../db/schema"
import { cancelSubscription, listInvoices, openPortal, resumeSubscription, startCheckout, subscriptionView, updateSeats, type InvoiceRow, type SubscriptionView } from "./service"

// Billing is the owner's business: writes need role key "owner"; reads also allow "admin". (Billing routes stay open to a blocked tenant: enforceBilling exempts /v1/billing.)
const roleGate = (...keys: string[]): MiddlewareHandler<AppEnv> => async (c, next) => {
  const member = c.get("member")
  if (!member || !keys.includes(member.roleKey)) throw Forbidden("forbidden")
  await next()
}
const ownerOnly = roleGate("owner")
const ownerOrAdmin = roleGate("owner", "admin")

export const SubscriptionDto = z
  .object({
    planId: z.string(), planName: z.string(), priceMonthlyMinor: z.number().int(), currency: z.string(),
    status: z.enum(["trialing", "active", "past_due", "canceled", "incomplete", "unpaid", "paused"]),
    seats: z.number().int(), seatsUsed: z.number().int(),
    trialEndsAt: z.string().nullable(), currentPeriodEnd: z.string().nullable(), cancelAtPeriodEnd: z.boolean(),
    billingState: z.enum(["ok", "grace", "blocked"]), graceEndsAt: z.string().nullable(),
    hasProviderSubscription: z.boolean(), hasCustomer: z.boolean(),
  })
  .openapi({
    example: {
      planId: "business", planName: "Business", priceMonthlyMinor: 14900, currency: "EUR", status: "active", seats: 40, seatsUsed: 12,
      trialEndsAt: null, currentPeriodEnd: "2026-12-17T00:00:00.000Z", cancelAtPeriodEnd: false, billingState: "ok", graceEndsAt: null,
      hasProviderSubscription: true, hasCustomer: true,
    },
  })
const UrlDto = z.object({ url: z.string() }).openapi({ example: { url: "https://checkout.stripe.com/c/pay/cs_test_a1b2c3" } })
const InvoiceDto = z
  .object({
    id: z.string().uuid(), providerInvoiceId: z.string(), amountMinor: z.number().int().openapi({ description: "Integer minor units (cents) of `currency`" }),
    currency: z.string().length(3), status: z.enum(["paid", "open", "failed"]), hostedUrl: z.string().nullable(),
    periodStart: z.string(), periodEnd: z.string(), createdAt: z.string(),
  })
  .openapi({
    example: {
      id: "0b6d1f3e-2a47-4a55-9c1e-7d6a9f0c5e11", providerInvoiceId: "in_1QxYzA2eZvKYlo2C", amountMinor: 14900, currency: "EUR", status: "paid",
      hostedUrl: "https://invoice.stripe.com/i/acct_1/test_abc", periodStart: "2026-11-17T00:00:00.000Z", periodEnd: "2026-12-17T00:00:00.000Z", createdAt: "2026-11-17T00:00:05.000Z",
    },
  })
export const InvoiceList = z.object({ items: z.array(InvoiceDto), nextCursor: z.string().nullable() }).openapi({ example: { items: [], nextCursor: null } })

const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { "application/json": { schema } } })

const getSub = createRoute({ method: "get", path: "/v1/billing/subscription", middleware: [requireTenant, ownerOrAdmin] as const, responses: { 200: json(SubscriptionDto, "The tenant's subscription (owner or admin)") } })
const getInvoices = createRoute({
  method: "get", path: "/v1/billing/invoices", middleware: [requireTenant, ownerOrAdmin] as const,
  request: { query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20), cursor: z.string().max(200).optional() }) },
  responses: { 200: json(InvoiceList, "Invoices, newest first; pass nextCursor back as cursor") },
})
const checkout = createRoute({
  method: "post", path: "/v1/billing/checkout", middleware: [requireTenant, ownerOnly] as const,
  request: { body: { required: true, content: { "application/json": { schema: z.object({ planId: z.string().min(1).max(64) }).openapi({ example: { planId: "business" } }) } } } },
  responses: { 200: json(UrlDto, "Hosted checkout URL (success/cancel return to APP_URL/settings/billing)") },
})
const portal = createRoute({ method: "post", path: "/v1/billing/portal", middleware: [requireTenant, ownerOnly] as const, responses: { 200: json(UrlDto, "Hosted billing portal URL") } })
const cancel = createRoute({ method: "post", path: "/v1/billing/cancel", middleware: [requireTenant, ownerOnly] as const, responses: { 200: json(SubscriptionDto, "Cancellation scheduled for the period end") } })
const resume = createRoute({ method: "post", path: "/v1/billing/resume", middleware: [requireTenant, ownerOnly] as const, responses: { 200: json(SubscriptionDto, "Scheduled cancellation withdrawn") } })
const seats = createRoute({
  method: "put", path: "/v1/billing/seats", middleware: [requireTenant, ownerOnly] as const,
  request: { body: { required: true, content: { "application/json": { schema: z.object({ seats: z.number().int().min(1).max(100000) }).openapi({ example: { seats: 30 } }) } } } },
  responses: { 200: json(SubscriptionDto, "Seats updated (never below the active members)") },
})

const iso = (d: Date | null) => d?.toISOString() ?? null
const subDto = (v: SubscriptionView) => ({ ...v, trialEndsAt: iso(v.trialEndsAt), currentPeriodEnd: iso(v.currentPeriodEnd), graceEndsAt: iso(v.graceEndsAt) })
const invDto = (r: InvoiceRow) => ({
  id: r.id, providerInvoiceId: r.providerInvoiceId, amountMinor: r.amountMinor, currency: r.currency, status: r.status, hostedUrl: r.hostedUrl,
  periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString(), createdAt: r.createdAt.toISOString(),
})

export const billingRoutes = newRouter()
  .openapi(getSub, async (c) => c.json(subDto(await subscriptionView(c.get("deps"), c.get("tenant")!.id)), 200))
  .openapi(getInvoices, async (c) => {
    const q = c.req.valid("query")
    const r = await listInvoices(c.get("deps"), c.get("tenant")!.id, { limit: q.limit, cursor: q.cursor })
    return c.json({ items: r.items.map(invDto), nextCursor: r.nextCursor }, 200)
  })
  .openapi(checkout, async (c) => {
    const deps = c.get("deps")
    const t = c.get("tenant")!
    const [row] = await deps.db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, t.id)) // `tenants` has no RLS
    return c.json(await startCheckout(deps, { id: t.id, name: row?.name ?? t.slug }, { userId: c.get("member")!.userId, email: c.get("user")!.email }, c.req.valid("json")), 200)
  })
  .openapi(portal, async (c) => c.json(await openPortal(c.get("deps"), c.get("tenant")!.id), 200))
  .openapi(cancel, async (c) => {
    const deps = c.get("deps")
    const id = c.get("tenant")!.id
    await cancelSubscription(deps, id, c.get("member")!.userId)
    return c.json(subDto(await subscriptionView(deps, id)), 200)
  })
  .openapi(resume, async (c) => {
    const deps = c.get("deps")
    const id = c.get("tenant")!.id
    await resumeSubscription(deps, id, c.get("member")!.userId)
    return c.json(subDto(await subscriptionView(deps, id)), 200)
  })
  .openapi(seats, async (c) => {
    const deps = c.get("deps")
    const id = c.get("tenant")!.id
    await updateSeats(deps, id, c.get("member")!.userId, c.req.valid("json").seats)
    return c.json(subDto(await subscriptionView(deps, id)), 200)
  })
