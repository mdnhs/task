import { OpenAPIHono } from "@hono/zod-openapi"
import pino from "pino"
import type { Deps } from "./deps"
import type { AppEnv } from "./core/context"
import { AppError, problem } from "./core/errors"
import { requestId } from "./core/middleware/request-id"

export function createApp(deps: Deps) {
  const logger = pino({ level: deps.env.NODE_ENV === "test" ? "silent" : "info" })
  const app = new OpenAPIHono<AppEnv>()

  app.use("*", async (c, next) => {
    c.set("deps", deps)
    await next()
  })
  app.use("*", requestId)

  app.onError((err, c) => {
    const rid = c.get("requestId") ?? crypto.randomUUID()
    if (err instanceof AppError) return problem(err.status, err.code, err.title, rid)
    logger.error({ err, requestId: rid }, "unhandled error")
    return problem(500, "internal", "Internal Server Error", rid)
  })
  app.notFound((c) => problem(404, "not_found", "Not Found", c.get("requestId")))

  app.get("/healthz", (c) => c.json({ status: "ok" }))
  app.get("/readyz", async (c) => {
    try {
      await deps.db.execute("select 1")
      return c.json({ status: "ready" })
    } catch (err) {
      logger.error({ err, requestId: c.get("requestId") }, "readiness check failed")
      return c.json({ status: "unavailable" }, 503)
    }
  })

  app.doc31("/v1/openapi.json", { openapi: "3.1.0", info: { title: "OpsDesk API", version: "1" } })

  return app
}

export type AppType = ReturnType<typeof createApp>
