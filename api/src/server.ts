import { pathToFileURL } from "node:url"
import { serve } from "@hono/node-server"
import { createApp } from "./app"
import { makeDb } from "./db/client"
import type { Deps } from "./deps"
import { parseEnv, type Env } from "./env"

// Real db/auth/mailer wiring arrives in T1.1.
function makeDeps(env: Env): Deps {
  return {
    env,
    db: makeDb(env.DATABASE_URL),
    auth: undefined,
    clock: { now: () => new Date() },
    mailer: { send: async () => undefined },
  }
}

export function start(env: Env = parseEnv(process.env)) {
  return serve({ fetch: createApp(makeDeps(env)).fetch, port: env.PORT })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start()
