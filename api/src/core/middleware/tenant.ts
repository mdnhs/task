import { and, eq } from "drizzle-orm"
import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"
import { memberships, roles, tenants } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { AppError, NotFound } from "../errors"
import { strictestIdleHours } from "../session-policy"
import { loadDevice } from "./device"
import { enforceMfa } from "./mfa"
import { establishSession } from "./session"
import { enforceBilling } from "./module"
import { enterSupportPath } from "./support"
import { bindLog } from "../observability/logger"
import { enterApiKeyPath, presentedApiKey } from "./api-key"

/**
 * Resolves the tenant from X-Tenant and the caller's membership of it. Self-contained (it authenticates):
 * the idle check (R23) uses the user's STRICTEST session_idle_hours across all active memberships, never the
 * target tenant's, so it cannot be dodged by switching tenants and cannot reveal a foreign tenant's policy.
 * Order: header -> session (strictest idle) -> 404 if tenant missing/inactive -> membership.
 *
 * Support grants (T3.5): ONLY when the caller has no active membership of the tenant, the grant path (support.ts,
 * enterSupportPath) decides: active owner/support platform staff + MFA + an active grant for this tenant and this staff
 * member, read-only (non-GET 403 before any handler), deny-listed GETs refused, every request audited. Without a grant it
 * is the same 404 as any non-member. A member who is also staff always takes the normal path below, unchanged.
 *
 * API keys (T3.6): a `Bearer odk_...` Authorization header takes the key path (api-key.ts) instead of all of the above: tenant from
 * the key, creator's live role ∩ scopes, no MFA / device / idle gates (by design, ruling C7), enforceBilling still applies.
 *
 * Responses never distinguish "no such tenant" from "not a member" (both 404), and an unauthenticated caller
 * gets 401 for any slug, so slugs cannot be probed without a session.
 */
export const requireTenant: MiddlewareHandler<AppEnv> = async (c, next) => {
  // API-key principal (T3.6): `Authorization: Bearer odk_...` takes this path ALONE (any session cookie is ignored, X-Tenant is
  // optional but must match the key's tenant). See api-key.ts for the whole contract, incl. the gates that do not apply.
  const apiKey = presentedApiKey(c)
  if (apiKey !== null) {
    await enterApiKeyPath(c, apiKey)
    await next()
    return
  }
  const slug = c.req.header("x-tenant")?.trim()
  if (!slug) throw new AppError(400, "tenant_required", "Bad Request")
  const deps = c.get("deps")

  const [tenant] = await deps.db.select().from(tenants).where(eq(tenants.slug, slug)) // `tenants` has no RLS
  await establishSession(c, (userId) => strictestIdleHours(deps.db, userId)) // R23: never the target tenant's hours
  if (!tenant || tenant.status !== "active") throw NotFound()

  const userId = c.get("session")!.userId
  const member = await withTenant(deps.db, tenant.id, async (tx) => {
    const [row] = await tx
      .select({ roleId: memberships.roleId, roleKey: roles.key, status: memberships.status })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.tenantId, tenant.id), eq(memberships.userId, userId)))
    return row
  })
  const tenantCtx = {
    id: tenant.id,
    slug: tenant.slug,
    timezone: tenant.timezone,
    currency: tenant.currency,
    locale: tenant.locale,
    sessionIdleHours: tenant.sessionIdleHours,
    mfaPolicy: tenant.mfaPolicy,
  }
  if (!member || member.status !== "active") {
    await enterSupportPath(c, tenant) // throws NotFound() unless an active support grant applies
    c.set("tenant", tenantCtx)
    bindLog(c, { tenantId: tenant.id })
    await next()
    return
  }

  c.set("tenant", tenantCtx)
  bindLog(c, { tenantId: tenant.id })
  c.set("member", { userId, roleId: member.roleId, roleKey: member.roleKey })
  // Forced MFA (FR-M0-04) is applied here so every tenant route is covered by construction (fail closed).
  await enforceMfa(c, async () => {})
  // Device policy (FR-M0-10) is evaluated per request, here, so no tenant route can skip it.
  await loadDevice(c, async () => {})
  // Unpaid / expired trial (after the grace): non-GET routes answer 402, except billing and data export.
  await enforceBilling(c)
  await next()
}
