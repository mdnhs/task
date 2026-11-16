import pg from "pg"
import { makeDb, type Db } from "../src/db/client"

// Set by test/global-setup.ts (one Testcontainers postgres per run).
export const hasTestDb = () => Boolean(process.env.TEST_DATABASE_URL)

function need(name: "TEST_DATABASE_URL" | "TEST_DATABASE_OWNER_URL"): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} is not set; run through vitest (global setup)`)
  return v
}

let shared: Db | undefined
/** Lazily-created app_user db (pool connects on first query). Pool size 2. */
export function testDb(): Db {
  return (shared ??= makeDb(need("TEST_DATABASE_URL"), { max: 2 }))
}

let ownerPool: pg.Pool | undefined
const owner = () => (ownerPool ??= new pg.Pool({ connectionString: need("TEST_DATABASE_OWNER_URL"), max: 2 }))

/** Run SQL as app_owner (FORCE RLS applies to the owner too). */
export async function ownerQuery(sqlText: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  return (await owner().query(sqlText, params)).rows
}

/** Run SQL as app_owner inside a tenant context (FORCE RLS applies to the owner, so it only sees that tenant's rows). */
export async function ownerTenantQuery(tenant: string, sqlText: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const c = await owner().connect()
  try {
    await c.query("begin")
    await c.query("select set_config('app.tenant_id', $1, true)", [tenant])
    const res = await c.query(sqlText, params)
    await c.query("commit")
    return res.rows
  } catch (e) {
    await c.query("rollback")
    throw e
  } finally {
    c.release()
  }
}

export async function ownerInsertProbe(rows: { tenant: string; label: string }[]): Promise<void> {
  const c = await owner().connect()
  try {
    await c.query("begin")
    for (const r of rows) {
      // FORCE RLS applies to the owner too, so set the tenant per insert.
      await c.query("select set_config('app.tenant_id', $1, true)", [r.tenant])
      await c.query("insert into rls_probe (tenant_id, label) values ($1, $2)", [r.tenant, r.label])
    }
    await c.query("commit")
  } catch (e) {
    await c.query("rollback")
    throw e
  } finally {
    c.release()
  }
}

/** Truncate every table in public (as owner). Call in beforeEach. */
export async function resetDb(): Promise<void> {
  const rows = await ownerQuery("select tablename from pg_tables where schemaname = 'public'")
  if (rows.length === 0) return
  const list = rows.map((r) => `"public"."${String(r.tablename)}"`).join(", ")
  await ownerQuery(`truncate ${list} restart identity cascade`)
}

export async function closeTestDbs(): Promise<void> {
  await ownerPool?.end()
}
