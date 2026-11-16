import { createRoute, z } from "@hono/zod-openapi"
import { requirePlatformStaff } from "../../core/middleware/platform"
import { newRouter } from "../../core/router"
import { listPlatformDataRequests } from "./data-requests"
import { extendTrial, reactivateTenant, setTenantModules, suspendTenant } from "./lifecycle"
import { platformMetrics } from "./metrics"
import { listTenants, tenantDetail } from "./tenants"

const TID = "0b9d6f3e-5c1a-4f6e-9a57-2f1d3c8e7a10"
const NOW = "2026-11-17T09:00:00.000Z"
const Param = z.object({ tenantId: z.string().min(1).max(64).openapi({ param: { name: "tenantId", in: "path" }, example: TID }) })
const Paging = { page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }), pageSize: z.coerce.number().int().min(1).max(100).default(50).openapi({ example: 50 }) }
// reason / days are checked by the service (422), not by zod (which would answer 400).
const Reason = z.string().optional().openapi({ description: "Required: 1..500 characters (422 invalid_reason otherwise)", example: "Payment overdue 30 days" })

const ListItem = z.object({
  id: z.string(), slug: z.string(), name: z.string(), status: z.string(), createdAt: z.string(),
  planId: z.string().nullable(), subscriptionStatus: z.string().nullable(), seats: z.number().int().nullable(),
}).openapi({ example: { id: TID, slug: "coppers", name: "Coppers Cafe", status: "active", createdAt: NOW, planId: "business", subscriptionStatus: "active", seats: 40 } })
const ListDto = z.object({ items: z.array(ListItem), page: z.number().int(), pageSize: z.number().int(), total: z.number().int() })
  .openapi({ example: { items: [{ id: TID, slug: "coppers", name: "Coppers Cafe", status: "active", createdAt: NOW, planId: "business", subscriptionStatus: "active", seats: 40 }], page: 1, pageSize: 50, total: 1 } })

const DetailDto = z.object({
  tenant: z.object({ id: z.string(), slug: z.string(), name: z.string(), status: z.string(), timezone: z.string(), currency: z.string(), locale: z.string(), createdAt: z.string() }),
  subscription: z.object({ planId: z.string(), status: z.string(), seats: z.number().int(), trialEndsAt: z.string().nullable(), currentPeriodEnd: z.string().nullable(), cancelAtPeriodEnd: z.boolean(), hasProviderSubscription: z.boolean() }).nullable(),
  seatsUsed: z.number().int(), memberCount: z.number().int(),
  moduleOverrides: z.array(z.object({ module: z.string(), mode: z.enum(["grant", "revoke"]), reason: z.string(), setAt: z.string() })),
  lastActivityDate: z.string().nullable().openapi({ description: "Date (YYYY-MM-DD, UTC) of the newest tenant audit event; no detail" }),
  openDataRequests: z.number().int(),
}).openapi({
  example: {
    tenant: { id: TID, slug: "coppers", name: "Coppers Cafe", status: "active", timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", createdAt: NOW },
    subscription: { planId: "business", status: "active", seats: 40, trialEndsAt: null, currentPeriodEnd: "2026-12-17T00:00:00.000Z", cancelAtPeriodEnd: false, hasProviderSubscription: true },
    seatsUsed: 12, memberCount: 14, moduleOverrides: [{ module: "M2", mode: "grant", reason: "Pilot", setAt: NOW }], lastActivityDate: "2026-11-16", openDataRequests: 1,
  },
})

const MetricsDto = z.object({
  mrrMinor: z.record(z.string(), z.number().int()), arrMinor: z.record(z.string(), z.number().int()),
  trials: z.number().int(), pastDue: z.number().int(), churnLast30Days: z.number().int(),
}).openapi({ example: { mrrMinor: { EUR: 1450000 }, arrMinor: { EUR: 17400000 }, trials: 4, pastDue: 1, churnLast30Days: 2 } })

const DsrItem = z.object({ id: z.string(), tenantId: z.string(), tenantName: z.string(), kind: z.string(), status: z.string(), createdAt: z.string(), dueAt: z.string(), overdue: z.boolean() })
  .openapi({ example: { id: TID, tenantId: TID, tenantName: "Coppers Cafe", kind: "erase", status: "pending", createdAt: NOW, dueAt: "2026-12-17T09:00:00.000Z", overdue: false } })
const DsrDto = z.object({ items: z.array(DsrItem), page: z.number().int(), pageSize: z.number().int(), total: z.number().int() })
  .openapi({ example: { items: [{ id: TID, tenantId: TID, tenantName: "Coppers Cafe", kind: "erase", status: "pending", createdAt: NOW, dueAt: "2026-12-17T09:00:00.000Z", overdue: false }], page: 1, pageSize: 50, total: 1 } })

const ReasonBody = z.object({ reason: Reason }).openapi({ example: { reason: "Payment overdue 30 days" } })
const TrialBody = z.object({ days: z.number().optional().openapi({ description: "Integer 1..30 (422 invalid_days otherwise)", example: 7 }), reason: Reason }).openapi({ example: { days: 7, reason: "Sales call" } })
const ModulesBody = z.object({
  overrides: z.array(z.object({ module: z.string().min(1).max(64), mode: z.enum(["grant", "revoke"]) })).max(50),
  reason: Reason,
}).openapi({ example: { overrides: [{ module: "M2", mode: "grant" }], reason: "Pilot" } })
const StatusDto = z.object({ status: z.enum(["active", "suspended"]) }).openapi({ example: { status: "suspended" } })

const notFound = "404 tenant_not_found. "

const listRoute = createRoute({
  method: "get", path: "/v1/platform/tenants", middleware: [requirePlatformStaff("owner", "support", "billing", "viewer")] as const,
  request: { query: z.object({ q: z.string().max(100).optional(), status: z.string().max(32).optional(), plan: z.string().max(64).optional(), ...Paging }) },
  responses: { 200: { description: "Tenants with plan and subscription status (page of `pageSize`, newest first). Metadata only", content: { "application/json": { schema: ListDto } } } },
})
const detailRoute = createRoute({
  method: "get", path: "/v1/platform/tenants/{tenantId}", middleware: [requirePlatformStaff("owner", "support", "billing", "viewer")] as const, request: { params: Param },
  responses: { 200: { description: `Tenant 360: aggregates only, never member names or emails. ${notFound}`, content: { "application/json": { schema: DetailDto } } } },
})
const suspendRoute = createRoute({
  method: "post", path: "/v1/platform/tenants/{tenantId}/suspend", middleware: [requirePlatformStaff("owner", "support")] as const,
  request: { params: Param, body: { content: { "application/json": { schema: ReasonBody } }, required: true } },
  responses: { 200: { description: `Suspended (members get 404; data kept). Audited in the tenant chain (actor platform:<staffId>) and the platform chain. ${notFound}409 already_suspended, 422 invalid_reason`, content: { "application/json": { schema: StatusDto } } } },
})
const reactivateRoute = createRoute({
  method: "post", path: "/v1/platform/tenants/{tenantId}/reactivate", middleware: [requirePlatformStaff("owner", "support")] as const,
  request: { params: Param, body: { content: { "application/json": { schema: ReasonBody } }, required: true } },
  responses: { 200: { description: `Reactivated. ${notFound}409 not_suspended, 422 invalid_reason`, content: { "application/json": { schema: StatusDto } } } },
})
const trialRoute = createRoute({
  method: "post", path: "/v1/platform/tenants/{tenantId}/extend-trial", middleware: [requirePlatformStaff("owner", "support")] as const,
  request: { params: Param, body: { content: { "application/json": { schema: TrialBody } }, required: true } },
  responses: { 200: { description: `New trial end = max(now, trial end) + days. ${notFound}422 invalid_days | invalid_reason | not_trialing`, content: { "application/json": { schema: z.object({ trialEndsAt: z.string() }).openapi({ example: { trialEndsAt: "2026-11-24T09:00:00.000Z" } }) } } } },
})
const modulesRoute = createRoute({
  method: "put", path: "/v1/platform/tenants/{tenantId}/modules", middleware: [requirePlatformStaff("owner")] as const,
  request: { params: Param, body: { content: { "application/json": { schema: ModulesBody } }, required: true } },
  responses: { 200: { description: `Replaces the tenant's module overrides (unlisted ones are cleared); effective within 60 s. ${notFound}422 unknown_module | core_module | duplicate_module | invalid_reason`, content: { "application/json": { schema: z.object({ overrides: z.array(z.object({ module: z.string(), mode: z.enum(["grant", "revoke"]) })) }).openapi({ example: { overrides: [{ module: "M2", mode: "grant" }] } }) } } } },
})
const metricsRoute = createRoute({
  method: "get", path: "/v1/platform/metrics", middleware: [requirePlatformStaff("owner", "billing", "viewer")] as const,
  responses: { 200: { description: "MRR/ARR per currency in minor units (active + past_due subscriptions), trials, past_due, churn (moved to canceled in the last 30 days)", content: { "application/json": { schema: MetricsDto } } } },
})
const dsrRoute = createRoute({
  method: "get", path: "/v1/platform/data-requests", middleware: [requirePlatformStaff("owner", "support", "billing", "viewer")] as const, request: { query: z.object(Paging) },
  responses: { 200: { description: "GDPR requests across tenants, overdue first then due date ascending. No subject identity", content: { "application/json": { schema: DsrDto } } } },
})

const iso = (d: Date | null) => d?.toISOString() ?? null

export const platformConsoleRoutes = newRouter()
  .openapi(listRoute, async (c) => {
    const r = await listTenants(c.get("deps").db, c.req.valid("query"))
    return c.json({ ...r, items: r.items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() })) }, 200)
  })
  .openapi(detailRoute, async (c) => {
    const d = await tenantDetail(c.get("deps").db, c.req.valid("param").tenantId)
    return c.json({
      tenant: { ...d.tenant, createdAt: d.tenant.createdAt.toISOString() },
      subscription: d.subscription && { ...d.subscription, trialEndsAt: iso(d.subscription.trialEndsAt), currentPeriodEnd: iso(d.subscription.currentPeriodEnd) },
      seatsUsed: d.seatsUsed, memberCount: d.memberCount,
      moduleOverrides: d.moduleOverrides.map((o) => ({ ...o, setAt: o.setAt.toISOString() })),
      lastActivityDate: d.lastActivityDate, openDataRequests: d.openDataRequests,
    }, 200)
  })
  .openapi(suspendRoute, async (c) => c.json(await suspendTenant(c.get("deps"), c.req.valid("param").tenantId, c.get("staff")!, c.req.valid("json").reason), 200))
  .openapi(reactivateRoute, async (c) => c.json(await reactivateTenant(c.get("deps"), c.req.valid("param").tenantId, c.get("staff")!, c.req.valid("json").reason), 200))
  .openapi(trialRoute, async (c) => {
    const r = await extendTrial(c.get("deps"), c.req.valid("param").tenantId, c.get("staff")!, c.req.valid("json"))
    return c.json({ trialEndsAt: r.trialEndsAt.toISOString() }, 200)
  })
  .openapi(modulesRoute, async (c) => c.json(await setTenantModules(c.get("deps"), c.req.valid("param").tenantId, c.get("staff")!, c.req.valid("json")), 200))
  .openapi(metricsRoute, async (c) => {
    const deps = c.get("deps")
    return c.json(await platformMetrics(deps.db, deps.clock.now()), 200)
  })
  .openapi(dsrRoute, async (c) => {
    const deps = c.get("deps")
    const r = await listPlatformDataRequests(deps.db, deps.clock.now(), c.req.valid("query"))
    return c.json({ ...r, items: r.items.map((i) => ({ ...i, createdAt: i.createdAt.toISOString(), dueAt: i.dueAt.toISOString() })) }, 200)
  })
