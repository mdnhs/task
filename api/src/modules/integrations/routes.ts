import { createRoute, z } from "@hono/zod-openapi"
import { and, eq } from "drizzle-orm"
import { AppError } from "../../core/errors"
import { enforceMfa } from "../../core/middleware/mfa"
import { requirePermission } from "../../core/middleware/permission"
import { requireSession } from "../../core/middleware/session"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { memberships, roles, tenants } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { completeGoogle, consumeState, disconnect, landingUrl, listIntegrations, startGoogle } from "./service"

const Id = z.uuid()
const Integration = z.object({
  id: z.string(), provider: z.string(), status: z.string(), scopes: z.array(z.string()),
  accountEmail: z.string().nullable(), connectedBy: z.string(), connectedAt: z.string(), lastRefreshAt: z.string().nullable(),
})
const IntegrationList = z.array(Integration).openapi({
  example: [{ id: "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90", provider: "google", status: "connected", scopes: ["https://www.googleapis.com/auth/drive.readonly", "openid", "email"], accountEmail: "drive@example.com", connectedBy: "usr_123", connectedAt: "2026-11-17T09:00:00.000Z", lastRefreshAt: null }],
})
const StartOut = z.object({ url: z.string() }).openapi({ example: { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&code_challenge_method=S256&state=..." } })

const listRoute = createRoute({
  method: "get", path: "/v1/integrations", middleware: [requireTenant, requirePermission("settings", "read")] as const,
  responses: { 200: { description: "The tenant's integration connections. Tokens are never returned", content: { "application/json": { schema: IntegrationList } } } },
})
const startRoute = createRoute({
  method: "post", path: "/v1/integrations/google/start", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  responses: { 200: { description: "The Google consent URL (PKCE S256 + single-use state, valid 10 minutes). 503 integration_not_configured", content: { "application/json": { schema: StartOut } } } },
})
const callbackRoute = createRoute({
  method: "get", path: "/v1/integrations/google/callback", middleware: [requireSession] as const,
  request: { query: z.object({ code: z.string().max(2048).optional(), state: z.string().max(256).optional(), error: z.string().max(256).optional() }) },
  responses: {
    302: { description: "Redirect to APP_URL/settings/integrations?status=connected|error[&reason=<short code>]; no code or token is ever echoed. Must be called by the user who started. 400 invalid_oauth_state (unknown, expired, reused, or another user's state)" },
  },
})
const deleteRoute = createRoute({
  method: "delete", path: "/v1/integrations/{id}", middleware: [requireTenant, requirePermission("settings", "write")] as const,
  request: { params: z.object({ id: Id }) },
  responses: { 204: { description: "Revoked at Google (best effort), marked revoked and its tokens erased; idempotent. Another tenant's id is 404 integration_not_found" } },
})

const invalidState = () => new AppError(400, "invalid_oauth_state", "Bad Request")

export const integrationRoutes = newRouter()
  .openapi(listRoute, async (c) => {
    const t = c.get("tenant")!
    return c.json(await withTenant(c.get("deps").db, t.id, (tx) => listIntegrations(tx, t.id)), 200)
  })
  .openapi(startRoute, async (c) => {
    const t = c.get("tenant")!
    c.header("Cache-Control", "no-store")
    return c.json(await startGoogle(c.get("deps"), t.id, c.get("member")!.userId), 200)
  })
  .openapi(callbackRoute, async (c) => {
    const deps = c.get("deps")
    const user = c.get("user")!
    const q = c.req.valid("query")
    c.header("Cache-Control", "no-store")
    c.header("Referrer-Policy", "no-referrer")
    // The browser carries no X-Tenant: the tenant comes from the state, which only the user who started can spend.
    const s = await consumeState(deps, user.id, q.state)
    if (!s) throw invalidState()
    // Everything a tenant route enforces (active tenant + membership, forced MFA) is applied for THAT tenant before any exchange.
    const [tenant] = await deps.db.select().from(tenants).where(eq(tenants.id, s.tenantId))
    const member = await withTenant(deps.db, s.tenantId, async (tx) => {
      const [r] = await tx
        .select({ roleId: memberships.roleId, roleKey: roles.key, status: memberships.status })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.tenantId, s.tenantId), eq(memberships.userId, user.id)))
      return r
    })
    if (!tenant || tenant.status !== "active" || !member || member.status !== "active") throw invalidState()
    c.set("tenant", { id: tenant.id, slug: tenant.slug, timezone: tenant.timezone, currency: tenant.currency, locale: tenant.locale, sessionIdleHours: tenant.sessionIdleHours, mfaPolicy: tenant.mfaPolicy })
    c.set("member", { userId: user.id, roleId: member.roleId, roleKey: member.roleKey })
    await enforceMfa(c, async () => {})
    if (q.error) return c.redirect(landingUrl(deps, "error", q.error === "access_denied" ? "access_denied" : "provider_error"), 302)
    if (!q.code) return c.redirect(landingUrl(deps, "error", "missing_code"), 302)
    const r = await completeGoogle(deps, s, user.id, q.code)
    return c.redirect(r.ok ? landingUrl(deps, "connected") : landingUrl(deps, "error", r.reason), 302)
  })
  .openapi(deleteRoute, async (c) => {
    const t = c.get("tenant")!
    await disconnect(c.get("deps"), t.id, c.get("member")!.userId, c.req.valid("param").id)
    return c.body(null, 204)
  })
