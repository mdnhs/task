import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import pg from "pg"
import type { Logger } from "pino"
import { errorInfo } from "../core/safe-error"
import { makeLogger } from "../core/observability/logger"
import * as schema from "./schema"

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool }

/**
 * Connects with the given URL (app_user in production). The pool's `error` event (an idle connection dropped by a restart, a failover or a proxy idle kill) is logged
 * (error class and code only: the message can carry the connection string) and never thrown: an unhandled `error` would end the process. The pool opens a new connection on the next query.
 */
export function makeDb(url: string, opts: { max?: number; logger?: Logger } = {}): Db {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 })
  const logger = opts.logger ?? makeLogger({ service: "db" })
  pool.on("error", (err) => logger.error(errorInfo(err), "database pool error"))
  return drizzle(pool, { schema })
}
