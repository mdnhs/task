import { eq } from "drizzle-orm"
import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"
import type { Deps } from "../../deps"
import { session as sessionTable } from "../../db/schema"
import { Unauthorized } from "../errors"

// NFR-04 default; a tenant's own value (c.var.tenant, from T1.3) takes precedence.
export const DEFAULT_SESSION_IDLE_HOURS = 12

/**
 * The single idle-timeout implementation. Resolves the Better Auth session for these headers.
 * Returns null when there is no valid session. Throws session_expired (after deleting the
 * session row, so replays are plain unauthenticated) when idle past `idleHours`.
 * Otherwise stamps lastSeenAt = deps.clock.now() and returns the session.
 */
export async function authenticateSession(deps: Deps, headers: Headers, idleHours = DEFAULT_SESSION_IDLE_HOURS) {
  const { auth, db, clock } = deps
  const found = await auth.api.getSession({ headers })
  if (!found) return null

  const now = clock.now()
  const lastSeenAt = new Date(found.session.lastSeenAt ?? found.session.createdAt)
  if (now.getTime() - lastSeenAt.getTime() > idleHours * 3_600_000) {
    await db.delete(sessionTable).where(eq(sessionTable.id, found.session.id))
    throw Unauthorized("session_expired")
  }
  await db.update(sessionTable).set({ lastSeenAt: now }).where(eq(sessionTable.id, found.session.id))
  return { ...found, now }
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const found = await authenticateSession(c.get("deps"), c.req.raw.headers, c.get("tenant")?.sessionIdleHours)
  if (!found) throw Unauthorized("unauthenticated")

  c.set("session", {
    id: found.session.id,
    userId: found.user.id,
    lastSeenAt: found.now,
    // Fail closed until T1.5 records the per-session second-factor flag. Nothing reads this yet.
    mfaPassed: false,
  })
  c.set("user", { id: found.user.id, email: found.user.email })
  await next()
}
