import { and, eq } from "drizzle-orm"
import type { Context } from "hono"
import type { AppEnv } from "../context"
import { apiKeyIndex, apiKeys, memberships, roles, tenants, user } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { effectiveAccess, hashKey, hashesEqual, parseKey } from "../../modules/api-keys/key"
import { AppError, Forbidden, NotFound } from "../errors"
import { errorInfo } from "../safe-error"
import { EXPORT_OR_DOWNLOAD, routeDenied, type DenyRule } from "./deny-list"
import { enforceBilling } from "./module"
import { API_KEY_ROLE_ID, API_KEY_ROLE_KEY, apiKeyActor, homeOf, isPermissionGuard } from "./principal"

export { API_KEY_ROLE_ID, API_KEY_ROLE_KEY, apiKeyActor, apiKeyRole, markPermissionGuard } from "./principal"

/**
 * API-key principal (T3.6, FR-M0-17, ruling C7): the `Authorization: Bearer odk_...` path of requireTenant. A distinct, non-human
 * actor. Everything that decides what a key may do lives in this file (plus effectiveAccess in modules/api-keys/key.ts).
 *
 * In order, ANY failure of 1-4 is the same 401 `invalid_api_key` (no detail, so nothing can be told apart or probed):
 *  1. the token parses as odk_<8 base62>_<43 base64url> and its prefix is in api_key_index (ids-only platform map);
 *  2. the key row exists in ITS tenant and sha256(token) equals the stored hash (constant-time compare); not revoked;
 *  3. the tenant is active (not suspended / inactive);
 *  4. the creator is still an ACTIVE member of the tenant and was not erased (user.erased_at).
 *  Then: X-Tenant, if present, must name the key's tenant (else the generic 404; absent is fine, the tenant IS the key's);
 *  the deny-list (403 api_key_forbidden_route); a route with no requirePermission guard is refused (403 api_key_forbidden_route),
 *  because nothing would bound it by scopes; enforceBilling (an unpaid tenant's key can read, not write).
 * A session cookie is ignored for the request: this path never reads one.
 *
 * Not applied here, BY DESIGN (documented, accepted by ruling C7): the tenant MFA policy, the device gate and the session idle
 * timeout. A key has no session, no browser and no second factor; its protection is the secret itself, the scopes, the creator's
 * live role, revocation and the audit trail. c.var.device stays unset, so device-gated features fail closed.
 *
 * Permissions are scopes ∩ the creator's CURRENT role, evaluated per request (loadRole -> apiKeyRole). The synthetic member
 * is `apikey:<id>` with a nil-like sentinel role id (never a database role), so audit rows written by handlers carry the actor
 * `apikey:<id>` and a handler that looks the "member" up finds nothing (fail closed).
 */


/** Routes a key may never call (403 api_key_forbidden_route). THE single key deny-list; matched like the support deny-list (deny-list.ts). */
export const API_KEY_DENIED_ROUTES: readonly DenyRule[] = [
  { prefix: "/v1/api-keys", why: "a key must not mint, list or revoke keys" },
  { prefix: "/v1/settings/mfa-policy", why: "tenant MFA policy: a key is MFA-exempt and must not weaken the policy (all methods)" },
  { prefix: "/v1/webhooks", why: "a key must not manage outgoing webhooks (the signing secret is shown at creation)" },
  { prefix: "/v1/roles", why: "role management (privilege escalation)" },
  { prefix: "/v1/members", why: "membership and role assignment (privilege escalation)" },
  { prefix: "/v1/invites", why: "membership invitations" },
  { prefix: "/v1/settings/support-grants", why: "support access grants" },
  { prefix: "/v1/data-requests", why: "GDPR requests and data-subject data" },
  { prefix: "/v1/me", why: "personal, human-only routes (preferences, push tokens, data export)" },
  { prefix: "/v1/billing", why: "payment and subscription management" },
  { prefix: "/v1/integrations", why: "integrations: OAuth tokens and connection status" },
  { prefix: "/v1/devices", why: "device trust and enrolment codes" },
  { prefix: "/v1/device-policies", why: "device trust policy" },
  EXPORT_OR_DOWNLOAD,
]

const invalid = () => new AppError(401, "invalid_api_key", "Unauthorized")
const BEARER = /^Bearer\s+(odk_\S*)\s*$/i
/** The presented key when the Authorization header is a `Bearer odk_...` credential (then the API-key path is taken, whatever else is sent). */
export function presentedApiKey(c: Context<AppEnv>): string | null {
  const h = c.req.header("authorization")
  if (!h) return null
  if (/^Bearer\s+odk_/i.test(h.trim())) return BEARER.exec(h.trim())?.[1] ?? "odk_" // a malformed key is still the key path (401), never a cookie fallback
  return null
}

// last_used_at is written at most once per minute per key: an in-process gate in front of a conditional UPDATE (so several
// processes still cannot write more than ~once a minute each, and never once per request).
const TOUCH_MS = 60_000
const touched = new Map<string, number>()

async function touch(c: Context<AppEnv>, tenantId: string, keyId: string): Promise<void> {
  const deps = c.get("deps")
  const now = deps.clock.now()
  const last = touched.get(keyId)
  if (last !== undefined && now.getTime() - last < TOUCH_MS && now.getTime() >= last) return
  if (touched.size > 10_000) touched.clear()
  touched.set(keyId, now.getTime())
  try {
    const cutoff = new Date(now.getTime() - TOUCH_MS)
    await withTenant(deps.db, tenantId, async (tx) => {
      const rows = await tx.select({ at: apiKeys.lastUsedAt }).from(apiKeys).where(eq(apiKeys.id, keyId))
      const at = rows[0]?.at
      if (at && at > cutoff) return
      await tx.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, keyId))
    })
  } catch (err) {
    deps.logger.warn({ keyId, ...errorInfo(err) }, "api key last_used_at update failed") // never fails the request
  }
}

export async function enterApiKeyPath(c: Context<AppEnv>, token: string): Promise<void> {
  const deps = c.get("deps")
  const parsed = parseKey(token)
  const hash = hashKey(token) // always computed: the same work for a well-formed and a malformed key
  const dummy = "0".repeat(64)
  if (!parsed) {
    hashesEqual(hash, dummy)
    throw invalid()
  }
  const [idx] = await deps.db.select().from(apiKeyIndex).where(eq(apiKeyIndex.prefix, parsed.prefix)) // no RLS: ids only
  if (!idx) {
    hashesEqual(hash, dummy)
    throw invalid()
  }
  const [tenant] = await deps.db.select().from(tenants).where(eq(tenants.id, idx.targetTenantId)) // no RLS
  const found = tenant
    ? await withTenant(deps.db, tenant.id, async (tx) => {
        const [key] = await tx.select().from(apiKeys).where(and(eq(apiKeys.id, idx.keyId), eq(apiKeys.tenantId, tenant.id), eq(apiKeys.prefix, parsed.prefix)))
        if (!key) return null
        const [creator] = await tx
          .select({ status: memberships.status, access: roles.access, roleId: roles.id, roleKey: roles.key, home: roles.home, fieldRules: roles.fieldRules, erasedAt: user.erasedAt })
          .from(memberships)
          .innerJoin(roles, eq(roles.id, memberships.roleId))
          .innerJoin(user, eq(user.id, memberships.userId))
          .where(and(eq(memberships.tenantId, tenant.id), eq(memberships.userId, key.createdBy)))
        return { key, creator }
      })
    : null
  const match = hashesEqual(hash, found?.key.keyHash ?? dummy)
  if (!tenant || !found || !match || found.key.revokedAt !== null) throw invalid()
  if (tenant.status !== "active") throw invalid()
  const { key, creator } = found
  if (!creator || creator.status !== "active" || creator.erasedAt !== null) throw invalid()

  const slug = c.req.header("x-tenant")?.trim()
  if (slug && slug !== tenant.slug) throw NotFound() // the key is bound to its tenant; a header naming another is the generic 404
  if (routeDenied(API_KEY_DENIED_ROUTES, c.req.routePath, c.req.path)) throw Forbidden("api_key_forbidden_route")
  if (!c.req.matchedRoutes.some((r) => isPermissionGuard(r.handler))) throw Forbidden("api_key_forbidden_route") // nothing would bound it by scopes

  c.set("tenant", {
    id: tenant.id, slug: tenant.slug, timezone: tenant.timezone, currency: tenant.currency, locale: tenant.locale,
    sessionIdleHours: tenant.sessionIdleHours, mfaPolicy: tenant.mfaPolicy,
  })
  const access = effectiveAccess(key.scopes, creator.access as Record<string, string>)
  c.set("apiKey", { id: key.id, prefix: key.prefix, scopes: key.scopes, creatorId: key.createdBy, access, role: { id: creator.roleId, key: creator.roleKey, home: homeOf(creator.home), fieldRules: creator.fieldRules ?? {} } })
  c.set("member", { userId: apiKeyActor(key.id), roleId: API_KEY_ROLE_ID, roleKey: API_KEY_ROLE_KEY })
  await enforceBilling(c) // an unpaid / expired tenant's key reads but cannot write
  await touch(c, tenant.id, key.id)
}
