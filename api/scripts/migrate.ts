// The one-shot migration runner of a deploy (deploy/scripts/migrate.sh runs it as the `migrate` service, profile `ops`).
//   DATABASE_OWNER_URL=postgres://app_owner:...@host/db tsx scripts/migrate.ts
// Connects as app_owner ONLY (DATABASE_OWNER_URL); it never reads DATABASE_URL (app_user cannot create tables) and refuses a URL without a user name.
// A session advisory lock makes it a single runner: a second `migrate` waits for the first and then finds nothing to do.
// drizzle applies every pending migration in ONE transaction: a failure rolls all of them back and the database stays at the previous version.
// Prints the migration count before and after and safe codes only, never the URL, a password or a driver message (they can carry parameters).
import { pathToFileURL } from "node:url"
import pg from "pg"
import { runMigrations } from "../src/db/migrate"
import { errorInfo } from "../src/core/safe-error"

/** An arbitrary constant, one bigint key for the session advisory lock. */
export const MIGRATE_LOCK_KEY = 7_419_620_001

async function applied(client: pg.Client): Promise<number> {
  const r = await client.query("select to_regclass('drizzle.__drizzle_migrations') as t")
  if (!r.rows[0].t) return 0
  return Number((await client.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n)
}

export async function migrateOnce(ownerUrl: string, log: (line: string) => void = console.log): Promise<void> {
  if (!new URL(ownerUrl).username) throw new Error("owner_url_without_user")
  const lock = new pg.Client({ connectionString: ownerUrl })
  lock.on("error", () => {})
  await lock.connect()
  try {
    log("migrate: waiting for the migration lock")
    await lock.query("select pg_advisory_lock($1)", [MIGRATE_LOCK_KEY])
    const before = await applied(lock)
    await runMigrations(ownerUrl)
    log(`migrate: ok (applied ${before} -> ${await applied(lock)})`)
  } finally {
    await lock.end().catch(() => {}) // closing the session releases the lock
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_OWNER_URL
  if (!url) {
    console.error("migrate: DATABASE_OWNER_URL is not set")
    process.exit(2)
  }
  migrateOnce(url).then(
    () => process.exit(0),
    (e) => {
      const i = errorInfo(e)
      console.error(`migrate: failed (${i.name}${i.code ? ` ${i.code}` : ""}); the database is at its previous version`)
      process.exit(1)
    },
  )
}
