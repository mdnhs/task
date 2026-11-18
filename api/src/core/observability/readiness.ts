import { readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import type { Deps } from "../../deps"
import { envStorageConfig, getStorageSettings } from "../../modules/platform-storage/service"

const CHECK_TIMEOUT_MS = 1500

/** Number of migrations this build ships (the drizzle journal), the version the database must have reached. */
export const expectedMigrations = (): number => {
  const journal = JSON.parse(readFileSync(new URL("../../db/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: unknown[] }
  return journal.entries.length
}

const within = <T>(p: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS)))]).finally(() => clearTimeout(timer))
}
const ok = async (fn: () => Promise<unknown>): Promise<{ ok: boolean }> => {
  try {
    await within(fn())
    return { ok: true }
  } catch {
    return { ok: false } // no error text, no host, no connection string: only that it failed
  }
}

/**
 * GET /readyz (B7 Task 15): can this instance take traffic. Each dependency is named; any failing check makes it 503. It reads only
 * what the instance owns: Postgres (`select 1` and the applied migration count through `schema_migration_count()`), Redis through the
 * limiter store and the queue connection. Storage is a config-presence flag (an unconfigured bucket fails the file routes closed, not
 * the instance). No provider (mail, billing, storage, Google) is ever called.
 */
export async function readiness(deps: Deps): Promise<{ status: "ready" | "unavailable"; body: Record<string, unknown> }> {
  const expected = expectedMigrations()
  let applied: number | null = null
  const [db, redis, queue, migrations, storage] = await Promise.all([
    ok(() => deps.db.execute(sql`select 1`)),
    ok(async () => void (await deps.rateLimiter.ping?.())),
    ok(async () => void (await deps.queue.ping?.())),
    ok(async () => {
      const r = await deps.db.execute(sql`select public.schema_migration_count() as n`)
      applied = Number((r.rows?.[0] as { n?: unknown } | undefined)?.n ?? Number.NaN)
      if (!Number.isInteger(applied)) throw new Error("no version")
      if (applied < expected) throw new Error("behind")
    }),
    within(getStorageSettings(deps.db).then((s) => s.configured)).catch(() => false), // a presence check of the stored settings row, never a call to the bucket
  ])
  const checks = { db, redis, queue, migrations: { ...migrations, expected, applied } }
  const all = db.ok && redis.ok && queue.ok && migrations.ok
  return { status: all ? "ready" : "unavailable", body: { status: all ? "ready" : "unavailable", checks, storage: { configured: storage || envStorageConfig(deps.env) !== null } } }
}
