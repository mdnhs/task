import { pathToFileURL } from "node:url"
import pino from "pino"
import { serve } from "@hono/node-server"
import { createApp } from "./app"
import { makeDb } from "./db/client"
import type { Deps } from "./deps"
import { buildAuth } from "./modules/auth/auth"
import { makeMailer } from "./modules/platform-email"
import { makeLoggingPush } from "./core/push"
import { clamdFromEnv } from "./core/scan/clamd-scanner"
import { unconfiguredScanner } from "./core/scan/scanner"
import { makeStorage } from "./modules/platform-storage"
import { makeBullQueue } from "./core/queue/bull-queue"
import { parseEnv, type Env } from "./env"

export function makeDeps(env: Env): Deps {
  const db = makeDb(env.DATABASE_URL)
  const clock = { now: () => new Date() }
  const logger = pino({ level: "info" })
  const mailer = makeMailer({ env, db, logger })
  return { env, db, auth: buildAuth({ env, db, clock, mailer, logger }), clock, mailer, logger, queue: makeBullQueue(env.REDIS_URL), push: makeLoggingPush(logger), storage: makeStorage({ env, db }), scanner: clamdFromEnv(env) ?? unconfiguredScanner() }
}

export function start(env: Env = parseEnv(process.env)) {
  return serve({ fetch: createApp(makeDeps(env)).fetch, port: env.PORT })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start()
