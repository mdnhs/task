import { serve } from "@hono/node-server"
import { createApp } from "./app"
import type { Deps } from "./deps"
import { parseEnv } from "./env"

// Real db/auth/mailer wiring arrives in T0.3 / T1.1.
function makeDeps(env: ReturnType<typeof parseEnv>): Deps {
  return {
    env,
    db: { execute: async () => undefined },
    auth: undefined,
    clock: { now: () => new Date() },
    mailer: { send: async () => undefined },
  }
}

const env = parseEnv(process.env)
serve({ fetch: createApp(makeDeps(env)).fetch, port: env.PORT })
