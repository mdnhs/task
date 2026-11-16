import { OpenAPIHono } from "@hono/zod-openapi"
import { sql } from "drizzle-orm"
import { HTTPException } from "hono/http-exception"
import type { Deps } from "./deps"
import type { AppEnv } from "./core/context"
import { AppError, problem } from "./core/errors"
import { requestId } from "./core/middleware/request-id"
import { authRoutes } from "./modules/auth/routes"

const HTTP_CODES: Record<number, string> = {
  400: "bad_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found", 405: "method_not_allowed",
  413: "payload_too_large", 415: "unsupported_media_type", 429: "too_many_requests",
}
const STATUS_TITLES: Record<number, string> = {
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
  413: "Payload Too Large", 415: "Unsupported Media Type", 429: "Too Many Requests",
}

export function createApp(deps: Deps) {
  const { logger } = deps
  const app = new OpenAPIHono<AppEnv>()

  app.use("*", async (c, next) => {
    c.set("deps", deps)
    await next()
  })
  app.use("*", requestId)

  app.onError((err, c) => {
    const rid = c.get("requestId") ?? crypto.randomUUID()
    if (err instanceof AppError) return problem(err.status, err.code, err.title, rid)
    if (err instanceof HTTPException) {
      return problem(err.status, HTTP_CODES[err.status] ?? "http_error", STATUS_TITLES[err.status] ?? "Error", rid)
    }
    logger.error({ err, requestId: rid }, "unhandled error")
    return problem(500, "internal", "Internal Server Error", rid)
  })
  app.notFound((c) => problem(404, "not_found", "Not Found", c.get("requestId")))

  app.get("/healthz", (c) => c.json({ status: "ok" }))
  app.get("/readyz", async (c) => {
    try {
      await deps.db.execute(sql`select 1`)
      return c.json({ status: "ready" })
    } catch (err) {
      logger.error({ err, requestId: c.get("requestId") }, "readiness check failed")
      return c.json({ status: "unavailable" }, 503)
    }
  })

  app.route("/", authRoutes)

  app.doc31("/v1/openapi.json", { openapi: "3.1.0", info: { title: "OpsDesk API", version: "1" } })

  return app
}

export type AppType = ReturnType<typeof createApp>
