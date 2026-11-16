import { sql } from "drizzle-orm"
import { beforeEach, expect, test } from "vitest"
import { makeDb } from "./client"
import { withTenant } from "./tenant-tx"
import { rlsProbe } from "../../test/rls-probe"
import { ownerInsertProbe, ownerQuery, resetDb } from "../../test/db"

const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
// pool size 2 so the leak test reuses connections
const db = makeDb(process.env.TEST_DATABASE_URL!, { max: 2 })

beforeEach(resetDb)

test("RLS hides other tenant rows even without WHERE", async () => {
  await ownerInsertProbe([{ tenant: A, label: "a" }, { tenant: B, label: "b" }])
  const rows = await withTenant(db, A, (tx) => tx.select().from(rlsProbe))
  expect(rows.map((r) => r.label)).toEqual(["a"])
})
test("insert with another tenant's id is rejected", async () => {
  // drizzle wraps the pg error; the RLS message is on `cause`
  const err = await withTenant(db, A, (tx) => tx.insert(rlsProbe).values({ tenantId: B, label: "x" })).catch((e) => e)
  expect(String(err?.cause?.message ?? err?.message)).toMatch(/row-level security/)
})
test("query outside withTenant returns zero rows", async () => {
  await ownerInsertProbe([{ tenant: A, label: "a" }])
  expect(await db.select().from(rlsProbe)).toEqual([])
})
test("tenant setting does not leak to the next pooled query", async () => {
  await ownerInsertProbe([{ tenant: A, label: "a" }])
  await withTenant(db, A, (tx) => tx.select().from(rlsProbe))
  for (let i = 0; i < 20; i++) expect(await db.select().from(rlsProbe)).toEqual([])
})
test("every table with a tenant_id column has RLS enabled and forced", async () => {
  const bad = await ownerQuery(`SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE a.attname = 'tenant_id' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`)
  expect(bad).toEqual([])
})
test("app_user cannot bypass RLS", async () => {
  expect(await ownerQuery(`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_user'`)).toEqual([{ rolbypassrls: false }])
})
test("withTenant rejects a non-UUID tenant id before touching the db", async () => {
  let touched = false
  const fake = { transaction: async () => { touched = true } } as never
  await expect(withTenant(fake, "x'; drop table tenants;--", async () => 1)).rejects.toThrow(/tenant id/i)
  expect(touched).toBe(false)
})
test("app_user is not the owner and cannot DDL", async () => {
  await expect(db.execute(sql`create table nope (id int)`)).rejects.toThrow()
})
test("tenants table is reachable by app_user", async () => {
  expect(await db.execute(sql`select count(*)::int as n from tenants`).then((r) => r.rows)).toEqual([{ n: 0 }])
})
