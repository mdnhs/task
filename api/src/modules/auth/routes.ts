import { Hono } from "hono"
import type { AppEnv } from "../../core/context"
import { requireSession } from "../../core/middleware/session"

export const authRoutes = new Hono<AppEnv>()

// Better Auth owns everything under /api/auth/* (sign-up, sign-in, 2FA, OAuth callbacks, ...).
authRoutes.on(["GET", "POST"], "/api/auth/*", (c) => c.get("deps").auth.handler(c.req.raw))

// tenants is filled in by T1.3 (memberships).
authRoutes.get("/v1/me", requireSession, (c) => {
  const user = c.get("user")!
  return c.json({ user: { id: user.id, email: user.email }, tenants: [] as never[] })
})
