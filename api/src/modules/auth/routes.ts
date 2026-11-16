import { Hono } from "hono"
import type { AppEnv } from "../../core/context"
import { problem } from "../../core/errors"
import { authenticateSession, requireSession } from "../../core/middleware/session"

export const authRoutes = new Hono<AppEnv>()

// Better Auth owns everything under /api/auth/* (sign-up, sign-in, 2FA, OAuth callbacks, ...).
// Better Auth's session endpoints ignore lastSeenAt, so the same idle check runs first for any request
// carrying a valid session (idle: session deleted, 401 session_expired). Requests with no valid
// session (sign-in, sign-up, callbacks) pass straight through and touch nothing.
authRoutes.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const deps = c.get("deps")
  await authenticateSession(deps, c.req.raw.headers)
  const res = await deps.auth.handler(c.req.raw)
  // Map Better Auth's unverified-email refusal into our problem+json shape.
  if (res.status === 403 && res.headers.get("content-type")?.includes("json")) {
    const body = (await res.clone().json().catch(() => null)) as { code?: string } | null
    if (body?.code === "EMAIL_NOT_VERIFIED") {
      return problem(403, "email_not_verified", "Forbidden", c.get("requestId"))
    }
  }
  return res
})

// tenants is filled in by T1.3 (memberships).
authRoutes.get("/v1/me", requireSession, (c) => {
  const user = c.get("user")!
  return c.json({ user: { id: user.id, email: user.email }, tenants: [] as never[] })
})
