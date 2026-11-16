import { eq } from "drizzle-orm"
import type { Context, MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"
import type { Deps } from "../../deps"
import { session as sessionTable } from "../../db/schema"
import { Unauthorized } from "../errors"
import { DEFAULT_SESSION_IDLE_HOURS, strictestIdleHours } from "../session-policy"

export { DEFAULT_SESSION_IDLE_HOURS }

/**
 * The single idle-timeout implementation. Resolves the Better Auth session for these headers.
 * Returns null when there is no valid session. Throws session_expired (after deleting the
 * session row, so replays are plain unauthenticated) when idle past `idleHours`.
 * Otherwise stamps lastSeenAt = deps.clock.now() and returns the session.
 */
export type IdleHours = number | ((userId: string) => Promise<number>)

export async function authenticateSession(deps: Deps, headers: Headers, idle: IdleHours = DEFAULT_SESSION_IDLE_HOURS) {
  const { auth, db, clock } = deps
  const found = await auth.api.getSession({ headers })
  if (!found) return null

  const idleHours = typeof idle === "number" ? idle : await idle(found.user.id)
  const now = clock.now()
  const lastSeenAt = new Date(found.session.lastSeenAt ?? found.session.createdAt)
  if (now.getTime() - lastSeenAt.getTime() > idleHours * 3_600_000) {
    await db.delete(sessionTable).where(eq(sessionTable.id, found.session.id))
    throw Unauthorized("session_expired")
  }
  await db.update(sessionTable).set({ lastSeenAt: now }).where(eq(sessionTable.id, found.session.id))
  return { ...found, now }
}

/**
 * Authenticates and fills c.var.session / c.var.user. `idle` is always the user's STRICTEST session_idle_hours across
 * their memberships (R23), on tenant routes and tenant-less routes alike; never the target tenant's own hours.
 */
export async function establishSession(c: Context<AppEnv>, idle: IdleHours) {
  const found = await authenticateSession(c.get("deps"), c.req.raw.headers, idle)
  if (!found) throw Unauthorized("unauthenticated")
  c.set("session", {
    id: found.session.id,
    userId: found.user.id,
    lastSeenAt: found.now,
    // Fail closed until T1.5 records the per-session second-factor flag. Nothing reads this yet.
    mfaPassed: false,
  })
  c.set("user", { id: found.user.id, email: found.user.email })
}

// Idempotent: requireTenant already authenticated (with the strictest hours across memberships, R23), so it is not re-run (or re-stamped).
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get("session")) {
    await establishSession(c, (userId) => strictestIdleHours(c.get("deps").db, userId))
  }
  await next()
}
