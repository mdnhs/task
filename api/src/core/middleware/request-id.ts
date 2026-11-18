import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"

/** What an id from a client or a proxy may look like: 8 to 64 of letters, digits, `-` and `_` (a uuid, a trace id). Anything else is replaced, so a header can never forge a log line or a response header. */
export const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header("x-request-id")
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID()
  c.set("requestId", id)
  await next()
  c.res.headers.set("x-request-id", id)
}
