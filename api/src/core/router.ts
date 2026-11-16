import { OpenAPIHono } from "@hono/zod-openapi"
import type { AppEnv } from "./context"
import { problem } from "./errors"

/** OpenAPIHono whose request-validation failures are problem+json 400 `validation_failed` (no zod detail leaked). */
export function newRouter() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return problem(400, "validation_failed", "Bad Request", c.get("requestId"))
    },
  })
}
