import { Hono } from "hono"
import { getConnInfo } from "@hono/node-server/conninfo"
import type { AppEnv } from "../../core/context"
import { problem, statusCode, statusTitle } from "../../core/errors"
import { enforceRateLimit, hashKey, RATE } from "../../core/middleware/rate-limit"
import { clientIp, ipBucket } from "../../core/net/client-ip"
import { CLIENT_IP_HEADER } from "./auth"
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

/** POST paths under /api/auth that are guessable or send mail: limited per caller IP (all) and per target address (the mail senders). Sign-out, session reads and the rest stay free. */
const LIMITED_PREFIXES = ["/sign-in", "/sign-up", "/forget-password", "/request-password-reset", "/reset-password", "/send-verification-email", "/two-factor/verify"]
const MAIL_PATHS = ["/sign-up/email", "/forget-password", "/request-password-reset", "/send-verification-email"]

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
  // S3/S4: the one resolved caller address. Whatever the caller sent in our header is overwritten; Better Auth reads only this header.
  let socket: string | undefined
  try {
    socket = getConnInfo(c).remote.address
  } catch {
    socket = undefined // not on a node socket (tests)
  }
  const ip = clientIp(c.req.raw.headers, socket, deps.env.TRUST_PROXY_HOPS)
  if (c.req.method === "POST" && LIMITED_PREFIXES.some((p) => sub === p || sub.startsWith(`${p}/`))) {
    const blocked = await enforceRateLimit(c, "auth-ip", { limit: deps.env.AUTH_RATE_LIMIT_PER_MIN, windowSec: 60 }, ipBucket(ip), { failClosed: true })
    if (blocked) return blocked
    if (MAIL_PATHS.includes(sub)) {
      const email = ((await c.req.raw.clone().json().catch(() => null)) as { email?: unknown } | null)?.email
      if (typeof email === "string" && email) {
        const mailBlocked = await enforceRateLimit(c, "auth-mail", RATE.authMailAddress, hashKey(email), { failClosed: true })
        if (mailBlocked) return mailBlocked
      }
    }
  }
  const headers = new Headers(c.req.raw.headers)
  headers.set(CLIENT_IP_HEADER, ip)
  const res = await deps.auth.handler(new Request(c.req.raw, { headers }))
  // "Sign out other devices": logged like DELETE /v1/me/sessions/{id} (no tenant context, so no audit row; ids and outcome only, never a token or an IP).
  if (sub === "/revoke-other-sessions" && found) deps.logger.info({ userId: found.user.id, sessionId: found.session.id, requestId: c.get("requestId"), outcome: res.status < 400 ? "ok" : "failed" }, "other sessions revoked")
  // One place maps every Better Auth error to our problem+json shape. Its own error code (lower-cased,
  // e.g. invalid_email_or_password, email_not_verified) becomes `code`; its free-text message is dropped.
  if (res.status >= 400) return mapAuthError(res, c.get("requestId"))
  return res
})
