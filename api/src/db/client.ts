import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema"

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool }

/** Connects with the given URL (app_user in production). */
export function makeDb(url: string, opts: { max?: number } = {}): Db {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 })
  return drizzle(pool, { schema })
}
