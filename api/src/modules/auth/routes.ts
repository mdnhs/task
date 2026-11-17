import { Hono } from "hono"
import type { AppEnv } from "../../core/context"
import { problem, statusCode, statusTitle } from "../../core/errors"
import { authenticateSession } from "../../core/middleware/session"
import { strictestIdleHours } from "../../core/session-policy"

/** Better Auth error response -> problem+json, keeping its headers (notably Set-Cookie that clears the session). */
export async function mapAuthError(res: Response, requestId: string): Promise<Response> {
  const body = res.headers.get("content-type")?.includes("json")
    ? ((await res.clone().json().catch(() => null)) as { code?: unknown } | null)
    : null
  const code = typeof body?.code === "string" && body.code ? body.code.toLowerCase() : statusCode(res.status)
  const out = problem(res.status, code, statusTitle(res.status), requestId)
  for (const [name, value] of res.headers) {
    const n = name.toLowerCase()
    if (n === "content-type" || n === "content-length" || n === "set-cookie") continue
    out.headers.set(name, value)
  }
  // Each Set-Cookie separately; folding them into one header corrupts the cookies.
  for (const cookie of res.headers.getSetCookie()) out.headers.append("set-cookie", cookie)
  return out
}

/**
 * R27: Better Auth endpoints that reconfigure or escape the second factor (or other account security) with only a
 * password. A session that has NOT passed MFA, belonging to a user who has 2FA, must not reach them, otherwise
 * password-only access could disable/replace the victim's 2FA. verify-totp, verify-backup-code, sign-out,
 * get-session and send-verification-email stay open.
 * Maintenance: when upgrading better-auth, re-list its routes and add any new endpoint that changes credentials, the
 * second factor, linked accounts or email; the list is an allow-nothing-new deny-list, so a missed path is open.
 */
export const MFA_PROTECTED_AUTH_PATHS: readonly string[] = [
  "/two-factor/disable",
  "/two-factor/generate-backup-codes",
  "/two-factor/enable",
  "/two-factor/get-totp-uri",
  "/change-email",
  "/change-password",
  "/link-social",
  "/unlink-account",
  "/delete-user",
  "/revoke-sessions",
  "/revoke-session",
  "/revoke-other-sessions",
  "/update-user",
]

export const authRoutes = new Hono<AppEnv>()

// Better Auth owns everything under /api/auth/* (sign-up, sign-in, 2FA, OAuth callbacks, ...).
// Better Auth's session endpoints ignore lastSeenAt, so the same idle check runs first for any request
// carrying a valid session, using the STRICTEST session_idle_hours across the user's active memberships (R17) (idle: session deleted, 401 session_expired). Requests with no valid
// session (sign-in, sign-up, callbacks) pass straight through and touch nothing.
authRoutes.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const deps = c.get("deps")
  const found = await authenticateSession(deps, c.req.raw.headers, (userId) => strictestIdleHours(deps.db, userId))
  const sub = c.req.path.slice("/api/auth".length).replace(/\/+$/, "")
  if (found && found.user.twoFactorEnabled === true && found.session.mfaPassed !== true && MFA_PROTECTED_AUTH_PATHS.includes(sub)) {
    return problem(403, "mfa_required", "Forbidden", c.get("requestId"))
  }
  const res = await deps.auth.handler(c.req.raw)
  // "Sign out other devices": logged like DELETE /v1/me/sessions/{id} (no tenant context, so no audit row; ids and outcome only, never a token or an IP).
  if (sub === "/revoke-other-sessions" && found) deps.logger.info({ userId: found.user.id, sessionId: found.session.id, requestId: c.get("requestId"), outcome: res.status < 400 ? "ok" : "failed" }, "other sessions revoked")
  // One place maps every Better Auth error to our problem+json shape. Its own error code (lower-cased,
  // e.g. invalid_email_or_password, email_not_verified) becomes `code`; its free-text message is dropped.
  if (res.status >= 400) return mapAuthError(res, c.get("requestId"))
  return res
})
