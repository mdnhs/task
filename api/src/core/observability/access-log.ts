import type { Context, MiddlewareHandler } from "hono"
import { matchedRoutes } from "hono/route"
import type { AppEnv } from "../context"

/** The route TEMPLATE of the handler that answered (`/v1/tasks/{id}`), a fixed label for anything no route matched. Never the concrete path: ids and scanner junk must not create series or leak into logs. */
export function routeTemplate(c: Context<AppEnv>): string {
  const last = matchedRoutes(c).at(-1)
  if (!last || last.method === "ALL") return "unmatched" // only middleware matched (404)
  return last.path.replace(/:(\w+)(\{[^}]*\})?/g, "{$1}")
}

const statusClass = (s: number) => `${Math.floor(s / 100)}xx`

/**
 * Request context, the access log and the HTTP metrics (B7 Task 15). Sits between the request id and the security headers.
 *  - `c.get("log")` is a child logger bound to the request id (session and tenant resolution add userId and tenantId, see bindLog).
 *  - exactly one line per request: method, route template, status, duration (deps.clock), response bytes, ids. No query string, no
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
  let bytes: number | null = length !== null ? Number(length) : null
  if (bytes === null && /json|text/i.test(c.res.headers.get("content-type") ?? "") && c.res.body) {
    // small JSON and text bodies are buffered once and put back (no clone: a tee'd body can fail to read twice); a stream or a download is never buffered just to be counted
    const buf = await c.res.arrayBuffer()
    bytes = buf.byteLength
    c.res = new Response(buf, c.res)
  }
  const tenantId = c.get("tenant")?.id
  const userId = c.get("user")?.id ?? c.get("session")?.userId
  c.get("log").info({ method: c.req.method, route, status, durationMs, bytes, ...(tenantId ? { tenantId } : {}), ...(userId ? { userId } : {}) }, "request")
  deps.metrics.counter("http_requests_total", { method: c.req.method, route, status_class: statusClass(status) }).inc()
  deps.metrics.histogram("http_request_duration_seconds", { route }).observe(durationMs / 1000)
}
