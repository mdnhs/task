import { mfaRequired } from "@opsdesk/domain/mfa"
import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"
import { Unauthorized } from "../errors"

// Reachable while MFA is still outstanding: the caller must be able to see state and enrol/verify.
const ALLOW = (path: string) => path === "/v1/me" || path === "/v1/me/mfa" || path.startsWith("/v1/me/mfa/")

/**
 * Forced MFA (AC-M0-02). After requireTenant (which calls it, so no tenant route can skip it):
 * required + no 2FA enrolled -> 401 mfa_enrolment_required; enrolled but THIS session has not passed a
 * second factor -> 401 mfa_challenge. Not required -> pass, enrolled or not.
 */
export const enforceMfa: MiddlewareHandler<AppEnv> = async (c, next) => {
  const tenant = c.get("tenant")
  const member = c.get("member")
  const user = c.get("user")
  const session = c.get("session")
  if (!tenant || !member || !user || !session) throw Unauthorized("unauthenticated") // fail closed
  if (!ALLOW(c.req.path) && mfaRequired(tenant.mfaPolicy, member.roleKey)) {
    if (!user.twoFactorEnabled) throw Unauthorized("mfa_enrolment_required")
    if (!session.mfaPassed) throw Unauthorized("mfa_challenge")
  }
  await next()
}
