import { eq } from "drizzle-orm"
import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"
import { session as sessionTable } from "../../db/schema"
import { Unauthorized } from "../errors"

// NFR-04 default; a tenant's own value (c.var.tenant, from T1.3) takes precedence.
export const DEFAULT_SESSION_IDLE_HOURS = 12

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { auth, db, clock } = c.get("deps")
  const found = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!found) throw Unauthorized("unauthenticated")

  const now = clock.now()
  const idleMs = (c.get("tenant")?.sessionIdleHours ?? DEFAULT_SESSION_IDLE_HOURS) * 3_600_000
  const lastSeenAt = new Date(found.session.lastSeenAt ?? found.session.createdAt)
  if (now.getTime() - lastSeenAt.getTime() > idleMs) {
    // Revoke, so a replay of the same cookie is plain unauthenticated.
    await db.delete(sessionTable).where(eq(sessionTable.id, found.session.id))
    throw Unauthorized("session_expired")
  }
  await db.update(sessionTable).set({ lastSeenAt: now }).where(eq(sessionTable.id, found.session.id))

  c.set("session", {
    id: found.session.id,
    userId: found.user.id,
    lastSeenAt: now,
    // A 2FA user only gets a session after the second factor, so presence of 2FA means it was passed.
    mfaPassed: Boolean(found.user.twoFactorEnabled),
  })
  c.set("user", { id: found.user.id, email: found.user.email })
  await next()
}
