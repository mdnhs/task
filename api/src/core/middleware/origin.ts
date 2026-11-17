import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"
import { Forbidden } from "../errors"

const SAFE = new Set(["GET", "HEAD", "OPTIONS"])
const API_KEY = /^Bearer\s+odk_/i

/** scheme://host[:port] of a URL, or null when it is not an http(s) URL. A path, query or trailing slash makes an Origin header differ from this. */
const originOf = (url: string): string | null => {
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.origin : null
  } catch {
    return null
  }
}

/**
 * CSRF layer 2 (B6 ruling I6): a state-changing /v1 call that carries an `Origin` must carry OURS (`APP_URL`, the public web origin).
 * - Compared as exact origins (scheme, host, port): a sibling subdomain, another port, `null` or an Origin with a path never matches.
 * - Absent `Origin` passes (curl, server-to-server, and old same-origin form posts: SameSite=Lax cookies plus the BFF's own
 *   Origin and Sec-Fetch-Site check cover the browser path).
 * - `Authorization: Bearer odk_...` keys are exempt: no cookie is read on that path, so there is nothing to forge.
 * - GET/HEAD/OPTIONS are never checked.
 * It runs before authentication, so a forged cross-site request learns nothing (403, never 401/404).
 */
export const requireSameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (SAFE.has(c.req.method)) return next()
  const origin = c.req.header("origin")
  if (origin === undefined) return next()
  if (API_KEY.test(c.req.header("authorization")?.trim() ?? "")) return next()
  if (origin !== originOf(c.get("deps").env.APP_URL)) throw Forbidden("bad_origin")
  return next()
}
