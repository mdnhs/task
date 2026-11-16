import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import pg from "pg"

const folder = new URL("./migrations", import.meta.url).pathname

/** Applies migrations with the OWNER connection (DATABASE_OWNER_URL), never app_user. */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: folder })
  } finally {
    await pool.end()
  }
}
