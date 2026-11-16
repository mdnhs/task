import { eq } from "drizzle-orm"
import type { MiddlewareHandler } from "hono"
import type { AppEnv, PlatformRole } from "../context"
import { platformStaff } from "../../db/schema"
import { Forbidden, NotFound, Unauthorized } from "../errors"
import { strictestIdleHours } from "../session-policy"
import { establishSession } from "./session"

export type { PlatformRole }

/**
 * Gate for every /v1/platform route (platform super admin access). In this order:
 *  1. a valid session (strictest idle rule, same as requireSession) else 401;
 *  2. an ACTIVE platform_staff row, else 404 not_found for everyone else: a tenant owner, a suspended person and a
 *     stranger all see the same 404, so the platform area has no existence oracle (this runs BEFORE the MFA answer
 *     so that "needs MFA" is never learned by a non-staff user);
 *  3. 2FA enrolled (401 mfa_enrolment_required) AND this session passed it (401 mfa_challenge): always, no policy switch;
 *  4. the staff role is one of `roles` else 403 platform_forbidden.
 * Sets c.var.staff. The staff row is read on every request, so a suspension takes effect immediately.
 */
export function requirePlatformStaff(...roles: PlatformRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!c.get("session")) await establishSession(c, (userId) => strictestIdleHours(c.get("deps").db, userId))
    const session = c.get("session")
    const user = c.get("user")
    if (!session || !user) throw Unauthorized("unauthenticated") // fail closed
    const [row] = await c.get("deps").db.select({ role: platformStaff.role, status: platformStaff.status }).from(platformStaff).where(eq(platformStaff.userId, session.userId))
    if (!row || row.status !== "active") throw NotFound()
    if (!user.twoFactorEnabled) throw Unauthorized("mfa_enrolment_required")
    if (!session.mfaPassed) throw Unauthorized("mfa_challenge")
    const role = row.role as PlatformRole
    if (!roles.includes(role)) throw Forbidden("platform_forbidden")
    c.set("staff", { userId: session.userId, role })
    await next()
  }
}
