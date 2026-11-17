import { and, desc, eq, gt, isNull, lte } from "drizzle-orm"
import type { Context } from "hono"
import type { Access, Module } from "@opsdesk/domain/permissions"
import type { AppEnv, ResolvedRole } from "../context"
import { platformStaff, supportGrants } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { recordAudit } from "../../modules/audit/record"
import { MODULES } from "../../modules/rbac/access"
import { roleTemplates } from "../../modules/tenants/defaults"
import { Forbidden, NotFound, Unauthorized } from "../errors"
import { EXPORT_OR_DOWNLOAD, routeDenied, type DenyRule } from "./deny-list"

/**
 * Support access grants (T3.5, SRS §2.2): the read-only path of requireTenant for platform staff who are NOT members.
 * Everything that decides what a support session may do lives in this file.
 */

export const SUPPORT_ROLE_KEY = "support"
/**
 * Sentinel member.roleId / role.id on the grant path: the nil uuid. roles.id is gen_random_uuid() (v4, never nil), so it can
 * never match a database role, yet code that looks a role up by id (e.g. the people scope walk) gets "no row", not a type error.
 */
export const SUPPORT_ROLE_ID = "00000000-0000-0000-0000-000000000000"
/** Platform roles that may read a tenant under a grant (and create grants). */
export const SUPPORT_STAFF_ROLES = ["owner", "support"] as const
const READ_METHODS = new Set(["GET", "HEAD"])

/**
 * Ruling 4: GETs refused even under an active grant (403 support_forbidden_route, audited). THE single deny-list.
 * Matched against the matched route TEMPLATE (c.req.routePath, e.g. /v1/files/:id/download: canonical, immune to encoding
 * tricks) AND the decoded request path, both lower-cased with repeated/trailing slashes collapsed.
 */
export const SUPPORT_DENIED_ROUTES: readonly DenyRule[] = [
  { prefix: "/v1/data-requests", why: "GDPR requests and data-subject data" },
  { prefix: "/v1/me/data-export", why: "personal data export" },
  { prefix: "/v1/audit/export", why: "bulk audit export (download)" },
  { pattern: /^\/v1\/files\/[^/]+\/download$/, why: "file download (presigned GET)" },
  { pattern: /^\/v1\/tasks\/[^/]+\/voice-note$/, why: "personal audio (presigned GET)" },
  EXPORT_OR_DOWNLOAD,
  { prefix: "/v1/integrations", why: "integrations: OAuth tokens and connection status" },
  { prefix: "/v1/settings/support-grants", why: "support must not see or alter its own grants from the tenant side" },
  { prefix: "/v1/api-keys", why: "API keys (none yet; reserved)" },
  { prefix: "/v1/settings/api-keys", why: "API keys (none yet; reserved)" },
]

/** True when a support session must not GET this route (template or path). */
export function supportDenied(routePath: string, path: string): boolean {
  return routeDenied(SUPPORT_DENIED_ROUTES, routePath, path)
}

let cached: ResolvedRole | undefined
/**
 * Ruling 6: the synthetic role. The READ permissions of the `auditor` template in roles.json (a "write" there is cut to
 * "read"; anything else is "none"), for every module. No database role row. Frozen, so nothing can widen it at runtime.
 * Fails closed (throws) if roles.json has no auditor template.
 */
export function supportRole(): ResolvedRole {
  if (cached) return cached
  const auditor = roleTemplates().find((r) => r.id === "auditor")
  if (!auditor) throw new Error("roles.json has no auditor template: support role unavailable")
  const access = Object.fromEntries(
    MODULES.map((m) => [m, auditor.access[m] === "read" || auditor.access[m] === "write" ? "read" : "none"] as const),
  ) as Record<Module, Access>
  cached = Object.freeze({
    id: SUPPORT_ROLE_ID,
    key: SUPPORT_ROLE_KEY,
    label: "Platform support (read-only)",
    description: "Time-boxed read-only access under a support grant.",
    home: "manager" as const,
    access: Object.freeze(access) as Record<Module, Access>,
    fieldRules: Object.freeze({}) as Record<string, string[]>,
  })
  return cached
}

type TenantRow = { id: string }

/** Its own transaction, BEFORE the handler: if the audit row cannot be written the request fails (fail closed). */
async function audit(c: Context<AppEnv>, tenantId: string, action: string, entityId: string, staffId: string, after: Record<string, unknown>) {
  const deps = c.get("deps")
  const now = deps.clock.now()
  await withTenant(deps.db, tenantId, (tx) =>
    recordAudit(tx, tenantId, { action, entity: "support_grant", entityId, actorId: `platform:${staffId}`, before: null, after: { ...after, at: now.toISOString() } }, now),
  )
}

/**
 * The grant path (rulings 1-7). Called by requireTenant ONLY when the caller has no active membership of the tenant.
 * Every failure before the grant is found is the same 404 a non-member gets (no oracle). In order:
 *  1. active platform staff with role owner|support, else 404;
 *  2. 2FA enrolled and passed by THIS session (the platform rule, always): 401 mfa_enrolment_required / mfa_challenge,
 *     BEFORE the grant is looked at, so an un-MFA'd session can neither probe grants nor cause an audit row;
 *  3. a grant for THIS tenant and THIS staff with starts_at <= now < expires_at and revoked_at null, read fresh (no cache),
 *     else 404; when the latest grant for the pair is expired or revoked, `support.access_denied` is audited (reason);
 *  4. any method but GET/HEAD: 403 support_read_only (audited support.write_denied), before any handler;
 *  5. a deny-listed route: 403 support_forbidden_route (audited support.route_denied);
 *  6. `support.access` audited in its own transaction (fail closed), then the synthetic member/role are set.
 * Not applied here, by design: the tenant MFA policy (3 is stricter), the device gate (staff devices are not enrolled in
 * tenant registers; c.var.device stays unset so device-gated features fail closed), and enforceBilling (only reads pass).
 */
export async function enterSupportPath(c: Context<AppEnv>, tenant: TenantRow): Promise<void> {
  const deps = c.get("deps")
  const session = c.get("session")
  const user = c.get("user")
  if (!session || !user) throw Unauthorized("unauthenticated") // fail closed
  const staffId = session.userId
  const [staff] = await deps.db.select({ role: platformStaff.role, status: platformStaff.status }).from(platformStaff).where(eq(platformStaff.userId, staffId))
  if (!staff || staff.status !== "active" || !(SUPPORT_STAFF_ROLES as readonly string[]).includes(staff.role)) throw NotFound()

  // 2FA first (M1): a session that has not passed MFA learns nothing about grants and writes no audit row (not even access_denied).
  if (!user.twoFactorEnabled) throw Unauthorized("mfa_enrolment_required")
  if (!session.mfaPassed) throw Unauthorized("mfa_challenge")

  const now = deps.clock.now()
  const method = c.req.method.toUpperCase()
  const path = c.req.path // path only: never the query string
  const { active, latest } = await withTenant(deps.db, tenant.id, async (tx) => {
    const mine = and(eq(supportGrants.tenantId, tenant.id), eq(supportGrants.staffUserId, staffId))
    const [a] = await tx.select({ id: supportGrants.id }).from(supportGrants)
      .where(and(mine, isNull(supportGrants.revokedAt), lte(supportGrants.startsAt, now), gt(supportGrants.expiresAt, now))).limit(1)
    if (a) return { active: a, latest: undefined }
    const [l] = await tx.select({ id: supportGrants.id, revokedAt: supportGrants.revokedAt }).from(supportGrants)
      .where(and(mine, lte(supportGrants.startsAt, now))).orderBy(desc(supportGrants.startsAt)).limit(1)
    return { active: undefined, latest: l }
  })
  if (!active) {
    if (latest) await audit(c, tenant.id, "support.access_denied", latest.id, staffId, { grantId: latest.id, reason: latest.revokedAt ? "revoked" : "expired", method, path })
    throw NotFound()
  }

  const grantId = active.id
  if (!READ_METHODS.has(method)) {
    await audit(c, tenant.id, "support.write_denied", grantId, staffId, { grantId, method, path })
    throw Forbidden("support_read_only")
  }
  if (supportDenied(c.req.routePath, path)) {
    await audit(c, tenant.id, "support.route_denied", grantId, staffId, { grantId, method, path })
    throw Forbidden("support_forbidden_route")
  }
  await audit(c, tenant.id, "support.access", grantId, staffId, { grantId, method, path })

  c.set("support", { grantId, staffUserId: staffId })
  c.set("member", { userId: staffId, roleId: SUPPORT_ROLE_ID, roleKey: SUPPORT_ROLE_KEY })
  c.set("role", supportRole())
}
