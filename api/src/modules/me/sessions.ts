import { createRoute, z } from "@hono/zod-openapi"
import { and, desc, eq, gt, sql } from "drizzle-orm"
import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../../core/context"
import { Conflict, NotFound, Unauthorized } from "../../core/errors"
import { requireSession } from "../../core/middleware/session"
import { newRouter } from "../../core/router"
import { session as sessionTable } from "../../db/schema"

/**
 * The caller's own sign-in sessions (B6 I21), safe for a browser: id, a device label, created and last-seen times, and whether this is the
 * current one. NEVER the session token (Better Auth's own /list-sessions returns it, so the web boundary refuses that path) and never an IP address.
 */

/** "Chrome on macOS": a coarse label from the User-Agent. Anything unrecognised is "Unknown device"; the raw header is never returned. */
export function sessionLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? ""
  const os = /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux|X11/.test(ua) ? "Linux" : null
  // Order matters: Edge, Opera and Chrome on iOS all contain "Chrome"/"Safari" too.
  const browser = /Edg(?:e|A|iOS)?\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null
  if (browser && os) return `${browser} on ${os}`
  return browser ?? (os ? `Browser on ${os}` : "Unknown device")
}

/** After requireSession: a 2FA user whose session has not passed a second factor sees nothing here (the same fail-closed rule as every tenant route). */
const requirePassedMfa: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user")
  const session = c.get("session")
  if (!user || !session) throw Unauthorized("unauthenticated")
  if (user.twoFactorEnabled && !session.mfaPassed) throw Unauthorized("mfa_challenge")
  await next()
}

const SessionItem = z
  .object({
    id: z.string(),
    label: z.string().openapi({ description: "Browser and operating system, for example Chrome on macOS" }),
    createdAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
    current: z.boolean().openapi({ description: "True for the session making this request" }),
  })
  .openapi({ example: { id: "ses_7Hq2mZ4tW1", label: "Chrome on macOS", createdAt: "2026-11-16T09:00:00.000Z", lastSeenAt: "2026-11-16T10:30:00.000Z", current: true } })
const SessionList = z.object({ items: z.array(SessionItem) }).openapi({ example: { items: [{ id: "ses_7Hq2mZ4tW1", label: "Chrome on macOS", createdAt: "2026-11-16T09:00:00.000Z", lastSeenAt: "2026-11-16T10:30:00.000Z", current: true }] } })

const listRoute = createRoute({
  method: "get",
  path: "/v1/me/sessions",
  middleware: [requireSession, requirePassedMfa] as const,
  responses: { 200: { description: "The caller's active sessions, newest activity first. No token, no IP address", content: { "application/json": { schema: SessionList } } } },
})
const deleteRoute = createRoute({
  method: "delete",
  path: "/v1/me/sessions/{id}",
  middleware: [requireSession, requirePassedMfa] as const,
  request: { params: z.object({ id: z.string().min(1) }) },
  responses: { 204: { description: "Signed that session out. Another user's or a never-existing id is 404 session_not_found; the current session is 409 current_session (use sign-out)" } },
})

export const meSessionRoutes = newRouter()
  .openapi(listRoute, async (c) => {
    const { db } = c.get("deps")
    const me = c.get("session")!
    const rows = await db
      .select({ id: sessionTable.id, userAgent: sessionTable.userAgent, createdAt: sessionTable.createdAt, lastSeenAt: sessionTable.lastSeenAt })
      .from(sessionTable)
      // Better Auth's absolute expiry runs on the real clock (the idle clock is ours): an expired row is dead, not a device to show.
      .where(and(eq(sessionTable.userId, me.userId), gt(sessionTable.expiresAt, sql`now()`)))
      .orderBy(desc(sessionTable.lastSeenAt))
    return c.json({ items: rows.map((r) => ({ id: r.id, label: sessionLabel(r.userAgent), createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), current: r.id === me.id })) }, 200)
  })
  .openapi(deleteRoute, async (c) => {
    const { db } = c.get("deps")
    const me = c.get("session")!
    const { id } = c.req.valid("param")
    if (id === me.id) throw Conflict("current_session")
    // Own sessions only: the user id is part of the delete, so another user's id deletes nothing and answers like a never-existing one.
    const gone = await db.delete(sessionTable).where(and(eq(sessionTable.id, id), eq(sessionTable.userId, me.userId))).returning({ id: sessionTable.id })
    if (gone.length === 0) throw NotFound("session_not_found")
    return c.body(null, 204)
  })
