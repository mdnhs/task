import { expect, test } from "vitest"
import { sql } from "drizzle-orm"
import { ownerQuery, testDb } from "../../../test/db"
import { call, testApp } from "../../../test/harness"
import { expectedMigrations, readiness } from "./readiness"

test("migration 0042: schema_migration_count() answers the applied count to app_user and app_owner with no tenant context, and the drizzle schema itself stays closed to app_user", async () => {
  const n = expectedMigrations()
  expect(n).toBeGreaterThanOrEqual(43)
  const asUser = await testDb().execute(sql`select public.schema_migration_count() as n`)
  expect(Number((asUser.rows[0] as { n: unknown }).n)).toBe(n)
  expect(Number((await ownerQuery("select public.schema_migration_count() as n"))[0].n)).toBe(n)
  expect(String((await ownerQuery("select current_setting('app.tenant_id', true) as t"))[0].t ?? "")).toBe("") // no tenant context on the owner connection either
  await expect(testDb().execute(sql`select count(*) from drizzle.__drizzle_migrations`)).rejects.toMatchObject({ cause: { code: "42501" } })
})

test("readiness is not ready when the database is behind this build's migrations, and the details say by how many; the public route only says unavailable", async () => {
  const real = testDb()
  const behind = new Proxy(real, { get: (t, p, r) => (p === "execute" ? async (q: unknown) => ((await real.execute(q as never)), { rows: [{ n: expectedMigrations() - 1 }] }) : Reflect.get(t, p, r)) })
  const t = testApp({ db: behind as never })
  const r = await call(t.app, "GET", "/readyz")
  expect(r.status).toBe(503)
  expect(await r.json()).toEqual({ status: "unavailable" })
  const d = await readiness(t.deps)
  expect((d.body as { checks: { migrations: unknown } }).checks.migrations).toEqual({ ok: false, expected: expectedMigrations(), applied: expectedMigrations() - 1 })
})
