import type { Context, MiddlewareHandler } from "hono"
import { matchedRoutes } from "hono/route"
import type { AppEnv } from "../context"

/** The route TEMPLATE of the handler that answered (`/v1/tasks/{id}`), a fixed label for anything no route matched. Never the concrete path: ids and scanner junk must not create series or leak into logs. */
export function routeTemplate(c: Context<AppEnv>): string {
  const last = matchedRoutes(c).at(-1)
  if (!last || last.method === "ALL") return "unmatched" // only middleware matched (404)
  return last.path.replace(/:(\w+)(\{[^}]*\})?/g, "{$1}")
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
const methodLabel = (m: string) => (METHODS.has(m) ? m : "other") // a metric label is an allow-list: a client chooses its method

const statusClass = (s: number) => `${Math.floor(s / 100)}xx`

/**
 * Request context, the access log and the HTTP metrics (B7 Task 15). Sits between the request id and the security headers.
 *  - `c.get("log")` is a child logger bound to the request id (session and tenant resolution add userId and tenantId, see bindLog).
 *  - exactly one line per request: method, route template, status, duration (deps.clock), response bytes (the content-length header, else null: the body is never read), ids. No query string, no
 *    header and no body is ever read into the line.
 *  - http_requests_total{method,route,status_class} and http_request_duration_seconds{route}; the tenant id is not a label.
 */
export const accessLog = (): MiddlewareHandler<AppEnv> => async (c, next) => {
  const deps = c.get("deps")
  const started = deps.clock.now().getTime()
  c.set("log", deps.logger.child({ requestId: c.get("requestId") }))
  await next() // onError has already turned a throw into the response
  const durationMs = deps.clock.now().getTime() - started
  const route = routeTemplate(c)
  const status = c.res.status
  const length = c.res.headers.get("content-length")
  const bytes = length !== null && /^\d+$/.test(length) ? Number(length) : null // never read the body: an export or an event stream is streamed, and the response is left byte for byte untouched
  const tenantId = c.get("tenant")?.id
  const userId = c.get("user")?.id ?? c.get("session")?.userId
  c.get("log").info({ method: methodLabel(c.req.method), route, status, durationMs, bytes, ...(tenantId ? { tenantId } : {}), ...(userId ? { userId } : {}) }, "request")
  deps.metrics.counter("http_requests_total", { method: methodLabel(c.req.method), route, status_class: statusClass(status) }).inc()
  deps.metrics.histogram("http_request_duration_seconds", { route }).observe(durationMs / 1000)
}
