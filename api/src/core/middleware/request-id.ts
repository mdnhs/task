import type { MiddlewareHandler } from "hono"
import type { AppEnv } from "../context"
import { REQUEST_ID, runWithRequestId } from "../queue/request-context"

export { REQUEST_ID }

export const requestId: MiddlewareHandler<AppEnv> = async (c, next) => {
  const incoming = c.req.header("x-request-id")
  const id = incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID()
  c.set("requestId", id)
  await runWithRequestId(id, next) // jobs enqueued while serving the request carry this id in their envelope
  c.res.headers.set("x-request-id", id)
}
