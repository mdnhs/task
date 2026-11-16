import { pathToFileURL } from "node:url"
import { serve } from "@hono/node-server"
import { createApp } from "./app"
import { makeDb } from "./db/client"
import type { Deps } from "./deps"
import { buildAuth } from "./modules/auth/auth"
import { parseEnv, type Env } from "./env"

// Mailer is still a no-op until a real one lands.
function makeDeps(env: Env): Deps {
  const db = makeDb(env.DATABASE_URL)
  const clock = { now: () => new Date() }
  const mailer = { send: async () => undefined }
  return { env, db, auth: buildAuth({ env, db, clock, mailer }), clock, mailer }
}

export function start(env: Env = parseEnv(process.env)) {
  return serve({ fetch: createApp(makeDeps(env)).fetch, port: env.PORT })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start()
