import { and, eq } from "drizzle-orm"
import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"
import { memberships, roles, tenants } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { AppError, NotFound } from "../errors"
import { strictestIdleHours } from "../session-policy"
import { enforceMfa } from "./mfa"
import { establishSession } from "./session"

/**
 * Resolves the tenant from X-Tenant and the caller's membership of it. Self-contained (it authenticates):
 * the idle check (R23) uses the user's STRICTEST session_idle_hours across all active memberships, never the
 * target tenant's, so it cannot be dodged by switching tenants and cannot reveal a foreign tenant's policy.
 * Order: header -> session (strictest idle) -> 404 if tenant missing/inactive -> membership.
 *
 * Responses never distinguish "no such tenant" from "not a member" (both 404), and an unauthenticated caller
 * gets 401 for any slug, so slugs cannot be probed without a session.
 */
export const requireTenant: MiddlewareHandler<AppEnv> = async (c, next) => {
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
  if (!member || member.status !== "active") throw NotFound()

  c.set("tenant", {
    id: tenant.id,
    slug: tenant.slug,
    timezone: tenant.timezone,
    currency: tenant.currency,
    locale: tenant.locale,
    sessionIdleHours: tenant.sessionIdleHours,
    mfaPolicy: tenant.mfaPolicy,
  })
  c.set("member", { userId, roleId: member.roleId, roleKey: member.roleKey })
  // Forced MFA (FR-M0-04) is applied here so every tenant route is covered by construction (fail closed).
  await enforceMfa(c, async () => {})
  await next()
}
