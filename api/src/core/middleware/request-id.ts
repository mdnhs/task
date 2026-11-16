import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = c.req.header("x-request-id") || crypto.randomUUID()
  c.set("requestId", id)
  await next()
  c.res.headers.set("x-request-id", id)
}
