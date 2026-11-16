import { Hono } from "hono"
import type { AppEnv } from "../../core/context"
import { problem, statusCode, statusTitle } from "../../core/errors"
import { authenticateSession, requireSession } from "../../core/middleware/session"

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

export const authRoutes = new Hono<AppEnv>()

// Better Auth owns everything under /api/auth/* (sign-up, sign-in, 2FA, OAuth callbacks, ...).
// Better Auth's session endpoints ignore lastSeenAt, so the same idle check runs first for any request
// carrying a valid session (idle: session deleted, 401 session_expired). Requests with no valid
// session (sign-in, sign-up, callbacks) pass straight through and touch nothing.
authRoutes.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const deps = c.get("deps")
  await authenticateSession(deps, c.req.raw.headers)
  const res = await deps.auth.handler(c.req.raw)
  // One place maps every Better Auth error to our problem+json shape. Its own error code (lower-cased,
  // e.g. invalid_email_or_password, email_not_verified) becomes `code`; its free-text message is dropped.
  if (res.status >= 400) return mapAuthError(res, c.get("requestId"))
  return res
})

// tenants is filled in by T1.3 (memberships).
authRoutes.get("/v1/me", requireSession, (c) => {
  const user = c.get("user")!
  return c.json({ user: { id: user.id, email: user.email }, tenants: [] as never[] })
})
