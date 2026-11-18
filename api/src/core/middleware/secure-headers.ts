import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"

/**
 * Response hardening for everything the API itself serves (B7 Task 4). Bodies from the object-storage bucket cannot carry
 * these through a presigned URL; for those the API only ever links `attachment` for non-allowlisted types (s3-storage
 * presignGet) and the bucket domain gets a Cloudflare Transform Rule that adds `X-Content-Type-Options: nosniff`
 * (.claude/docs/deploy, Task 19).
 */
export const secureHeaders = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  await next()
  const h = c.res.headers
  h.set("x-content-type-options", "nosniff")
  h.set("referrer-policy", "no-referrer")
  h.set("cross-origin-resource-policy", "same-site")
  h.set("content-security-policy", "default-src 'none'; frame-ancestors 'none'")
  // Authenticated JSON (and problem+json) is never cached by a browser or an intermediary; a route that chose its own policy keeps it.
  if (!h.has("cache-control") && /json/i.test(h.get("content-type") ?? "") && c.req.path !== "/v1/openapi.json") h.set("cache-control", "no-store")
}
