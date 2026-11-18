import { pathToFileURL } from "node:url"
import { serve } from "@hono/node-server"
import { createApp } from "./app"
import { makeDb } from "./db/client"
import type { Deps } from "./deps"
import { buildAuth } from "./modules/auth/auth"
import { makeMailer } from "./modules/platform-email"
import { makeLoggingPush } from "./core/push"
import { clamdFromEnv } from "./core/scan/clamd-scanner"
import { unconfiguredScanner } from "./core/scan/scanner"
import { makeBilling } from "./modules/billing"
import { makeStorage } from "./modules/platform-storage"
import { makeOAuthClient } from "./core/oauth/google-oauth"
import { makeBullQueue } from "./core/queue/bull-queue"
import { makeNet } from "./core/net/net"
import { makeRedisRateLimiter } from "./core/middleware/rate-limit"
import { makeLogErrorReporter } from "./core/observability/error-reporter"
import { makeLogger } from "./core/observability/logger"
import { makeMetrics, startMetricsServer } from "./core/observability/metrics"
import { errorInfo } from "./core/safe-error"
import { parseEnv, type Env } from "./env"

export function makeDeps(env: Env, o: { service?: "api" | "worker" } = {}): Deps {
  const db = makeDb(env.DATABASE_URL)
  const clock = { now: () => new Date() }
  const logger = makeLogger({ level: env.LOG_LEVEL, service: o.service ?? "api" })
  const metrics = makeMetrics()
  const errorReporter = makeLogErrorReporter(logger) // a Sentry / OpenTelemetry adapter replaces this line at go-live (ErrorReporter, ruling S10)
  const mailer = makeMailer({ env, db, logger })
  const rateLimiter = makeRedisRateLimiter(env.REDIS_URL)
  return { env, db, auth: buildAuth({ env, db, clock, mailer, logger, rateLimiter }), rateLimiter, clock, mailer, logger, queue: makeBullQueue(env.REDIS_URL), push: makeLoggingPush(logger), storage: makeStorage({ env, db }), scanner: clamdFromEnv(env) ?? unconfiguredScanner(), oauth: makeOAuthClient(env), billing: makeBilling({ env, db }), net: makeNet(), metrics, errorReporter }
}

/** The internal metrics listener (ruling S10); a no-op when `port` is unset. The pool gauge is read at scrape time. */
export async function startInternalMetrics(deps: Deps, port: number | undefined) {
  if (port === undefined) return undefined
  return startMetricsServer({ metrics: deps.metrics, port, host: deps.env.METRICS_HOST, collect: () => deps.metrics.gauge("db_pool_waiting").set(deps.db.$client.waitingCount) })
}

export function start(env: Env = parseEnv(process.env)) {
  const deps = makeDeps(env)
  const server = serve({ fetch: createApp(deps).fetch, port: env.PORT })
  startInternalMetrics(deps, env.METRICS_PORT)
    .then((metrics) => metrics && server.on("close", () => metrics.close()))
    .catch((err) => deps.logger.error({ ...errorInfo(err) }, "metrics listener failed to start")) // the API keeps serving; metrics are not a reason to stay down
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start()
