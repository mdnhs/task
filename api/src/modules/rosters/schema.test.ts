import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, describe, expect, test } from "vitest"

// B8 Task 2 (migration 0043): locations, supervisor grants, office limits, shift types, targets, qualifications and roles.roster_level.
const NEW_TABLES = ["locations", "location_supervisors", "roster_office_limits", "shift_types", "shift_type_targets", "member_qualifications"]
const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL, max: 2 })
const app = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 })
afterAll(async () => {
  await owner.end()
  await app.end()
})

/** One transaction as `pool` with the tenant context set (or none); `fn` may throw to roll back. */
async function tx<T>(pool: pg.Pool, tenant: string | null, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query("begin")
    if (tenant) await c.query("select set_config('app.tenant_id', $1, true)", [tenant])
    const r = await fn(c)
    await c.query("commit")
    return r
  } catch (e) {
    await c.query("rollback")
    throw e
  } finally {
    c.release()
  }
}

type Seed = { id: string; user: string; location: string }
/** A tenant with one member, one location, one supervisor grant, one office limit, one qualification (as app_owner, tenant context per tenant). */
async function seedTenant(label: string): Promise<Seed> {
  const id = randomUUID()
  const user = `u-${randomUUID()}`
  const location = randomUUID()
  await owner.query("insert into tenants (id, slug, name) values ($1, $2, $3)", [id, `r-${id.slice(0, 8)}`, label])
  await owner.query(`insert into "user" (id, name, email) values ($1, $2, $3)`, [user, label, `${user}@example.test`])
  await tx(owner, id, async (c) => {
    const role = (await c.query("insert into roles (tenant_id, key, label, home, access) values ($1, 'staff', 'Staff', '/', '{}') returning id", [id])).rows[0].id
    await c.query("insert into memberships (tenant_id, user_id, role_id, joined_at) values ($1, $2, $3, now())", [id, user, role])
    await c.query("insert into locations (id, tenant_id, name, created_at, updated_at) values ($1, $2, 'Site', now(), now())", [location, id])
    await c.query("insert into location_supervisors (tenant_id, location_id, user_id, created_at) values ($1, $2, $3, now())", [id, location, user])
    await c.query("insert into roster_office_limits (tenant_id, user_id, location_id) values ($1, $2, $3)", [id, user, location])
    await c.query("insert into member_qualifications (tenant_id, user_id, type, created_at, updated_at) values ($1, $2, 'PSA licence', now(), now())", [id, user])
  })
  return { id, user, location }
}

describe("migration 0043 tables", () => {
  test("every new table has RLS enabled and FORCED and the tenant_isolation policy (catalog query)", async () => {
    const rows = (await owner.query("select c.relname, c.relrowsecurity, c.relforcerowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname and p.policyname = 'tenant_isolation') as pol from pg_class c where c.relname = any($1) and c.relkind = 'r' order by 1", [NEW_TABLES])).rows
    expect(rows.map((r) => r.relname)).toEqual([...NEW_TABLES].sort())
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity, Number(r.pol)]).toEqual([r.relname, true, true, 1])
  })

  test("app_user without tenant context reads zero rows of each new table", async () => {
    await seedTenant("A")
    for (const t of NEW_TABLES) {
      expect((await owner.query(`select count(*)::int as n from ${t}`)).rows[0].n).toBe(0) // FORCE: the owner without context sees nothing either
      expect((await app.query(`select count(*)::int as n from ${t}`)).rows[0].n).toBe(0)
    }
  })

  test("app_user in tenant A cannot insert a row with tenant B's tenant_id (WITH CHECK)", async () => {
    const a = await seedTenant("A")
    const b = await seedTenant("B")
    await expect(tx(app, a.id, (c) => c.query("insert into locations (tenant_id, name, created_at, updated_at) values ($1, 'Evil', now(), now())", [b.id]))).rejects.toMatchObject({ code: "42501" })
    await expect(tx(app, a.id, (c) => c.query("insert into shift_type_targets (tenant_id, shift_type_id, weekday, count) values ($1, $2, 1, 1)", [b.id, randomUUID()]))).rejects.toMatchObject({ code: "42501" })
    // ... and reads only its own rows
    expect((await tx(app, a.id, (c) => c.query("select tenant_id from locations"))).rows.every((r) => r.tenant_id === a.id)).toBe(true)
  })

  test("a composite FK refuses a supervisor row whose location belongs to another tenant", async () => {
    const a = await seedTenant("A")
    const b = await seedTenant("B")
    await expect(tx(owner, a.id, (c) => c.query("insert into location_supervisors (tenant_id, location_id, user_id, created_at) values ($1, $2, $3, now())", [a.id, b.location, a.user]))).rejects.toMatchObject({ code: "23503" })
    await expect(tx(owner, a.id, (c) => c.query("insert into shift_types (tenant_id, location_id, name, start_time, end_time, role, created_at, updated_at) values ($1, $2, 'X', '08:00', '16:00', 'Guard', now(), now())", [a.id, b.location]))).rejects.toMatchObject({ code: "23503" })
  })

  test("deleting a membership cascades its supervisor grant, office limit and qualifications; deleting a proof file clears only file_id", async () => {
    const a = await seedTenant("A")
    const file = randomUUID()
    await tx(owner, a.id, async (c) => {
      await c.query("insert into files (id, tenant_id, key, name, mime, size_bytes, created_at) values ($1, $2, $3, 'p.pdf', 'application/pdf', 1, now())", [file, a.id, `t/${a.id}/${file}`])
      await c.query("update member_qualifications set file_id = $1 where tenant_id = $2", [file, a.id])
      await c.query("delete from files where id = $1", [file])
      const q = (await c.query("select tenant_id, file_id from member_qualifications")).rows
      expect(q).toEqual([{ tenant_id: a.id, file_id: null }]) // tenant_id is never nulled
      await c.query("delete from memberships where tenant_id = $1 and user_id = $2", [a.id, a.user])
      for (const t of ["location_supervisors", "roster_office_limits", "member_qualifications"]) expect((await c.query(`select count(*)::int as n from ${t}`)).rows[0].n).toBe(0)
      expect((await c.query("select count(*)::int as n from locations")).rows[0].n).toBe(1) // the site stays
    })
  })

  test("shift_type end may equal start only through the overnight rule (no CHECK on end > start)", async () => {
    const a = await seedTenant("A")
    await tx(owner, a.id, async (c) => {
      const ins = (name: string, s: string, e: string) => c.query("insert into shift_types (tenant_id, location_id, name, start_time, end_time, role, created_at, updated_at) values ($1, $2, $3, $4, $5, 'Guard', now(), now())", [a.id, a.location, name, s, e])
      await ins("Night", "22:00", "06:00") // ends the next day
      await ins("Round the clock", "08:00", "08:00")
      await expect(ins("Bad", "25:00", "06:00")).rejects.toMatchObject({ code: "23514" })
    })
  })

  test("locations: name, radius and coordinate checks; active name unique per tenant (case-insensitive), archived names free", async () => {
    const a = await seedTenant("A")
    const ins = (c: pg.PoolClient, name: string, extra = "", archived = false) => c.query(`insert into locations (tenant_id, name, ${extra ? extra.split("=")[0] + "," : ""} archived_at, created_at, updated_at) values ($1, $2, ${extra ? extra.split("=")[1] + "," : ""} ${archived ? "now()" : "null"}, now(), now())`, [a.id, name])
    await expect(tx(owner, a.id, (c) => ins(c, "site"))).rejects.toMatchObject({ code: "23505" }) // "Site" exists
    await expect(tx(owner, a.id, (c) => ins(c, "R", "zone_radius_m=5001"))).rejects.toMatchObject({ code: "23514" })
    await expect(tx(owner, a.id, (c) => ins(c, "Lat", "lat=91"))).rejects.toMatchObject({ code: "23514" })
    await expect(tx(owner, a.id, (c) => ins(c, "Lng", "lng=-181"))).rejects.toMatchObject({ code: "23514" })
    await expect(tx(owner, a.id, (c) => ins(c, ""))).rejects.toMatchObject({ code: "23514" })
    await tx(owner, a.id, (c) => ins(c, "Edge", "zone_radius_m=5000"))
    await tx(owner, a.id, (c) => ins(c, "Site", "", true)) // archived duplicate is fine
  })

  test("roster_level check rejects an unknown value", async () => {
    const a = await seedTenant("A")
    await expect(tx(owner, a.id, (c) => c.query("update roles set roster_level = 'boss' where tenant_id = $1", [a.id]))).rejects.toMatchObject({ code: "23514" })
    await tx(owner, a.id, async (c) => {
      await c.query("update roles set roster_level = 'office' where tenant_id = $1", [a.id])
      await c.query("update roles set roster_level = null where tenant_id = $1", [a.id])
    })
  })
})

describe("migration 0043 SQL run for real", () => {
  const file = readFileSync(new URL("../../db/migrations/0043_roster_locations.sql", import.meta.url), "utf8")
  const KEYS = ["owner", "admin", "roster-manager", "location-supervisor", "manager", "employee"]

  test("backfill: roles.roster_level is set for template roles of 3 tenants, run as app_owner WITHOUT tenant context, count asserted per tenant, app.tenant_id is '' afterwards", async () => {
    const c = await owner.connect()
    try {
      await c.query("begin") // rolled back at the end: nothing of this test stays
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("") // the migrator has no tenant context
      const ids = [randomUUID(), randomUUID(), randomUUID()]
      for (const id of ids) {
        await c.query("insert into tenants (id, slug, name) values ($1, $2, 'T')", [id, `m-${id.slice(0, 8)}`])
        await c.query("select set_config('app.tenant_id', $1, true)", [id])
        for (const k of KEYS) await c.query("insert into roles (tenant_id, key, label, home, access, is_template) values ($1, $2, $2, '/', '{}', true)", [id, k])
        await c.query("insert into roles (tenant_id, key, label, home, access, is_template) values ($1, 'custom', 'Custom', '/', '{}', false)", [id]) // a tenant-made role keeps null
      }
      await c.query("select set_config('app.tenant_id', '', true)")
      // The state before 0043: no new tables, no column. Then the real file, statement by statement, as the migrator runs it.
      for (const t of [...NEW_TABLES].reverse()) await c.query(`drop table ${t} cascade`)
      await c.query("alter table roles drop column roster_level")
      for (const stmt of file.split("--> statement-breakpoint")) if (stmt.trim()) await c.query(stmt)
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("") // reset after the loop
      for (const id of ids) {
        await c.query("select set_config('app.tenant_id', $1, true)", [id])
        const got = (await c.query("select key, roster_level from roles order by key")).rows
        expect(got).toEqual([
          { key: "admin", roster_level: "office" },
          { key: "custom", roster_level: null },
          { key: "employee", roster_level: null },
          { key: "location-supervisor", roster_level: "supervisor" },
          { key: "manager", roster_level: null },
          { key: "owner", roster_level: "office" },
          { key: "roster-manager", roster_level: "office" },
        ])
        expect((await c.query("select count(*)::int as n from roles where roster_level = 'office'")).rows[0].n).toBe(3)
        expect((await c.query("select count(*)::int as n from roles where roster_level = 'supervisor'")).rows[0].n).toBe(1)
      }
      await c.query("select set_config('app.tenant_id', '', true)")
      for (const t of NEW_TABLES) {
        const r = (await c.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = $1", [t])).rows[0]
        expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
      }
    } finally {
      await c.query("rollback")
      c.release()
    }
  })

  test("the journal and the 0043 snapshot follow 0042", () => {
    const j = JSON.parse(readFileSync(new URL("../../db/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: { idx: number; tag: string }[] }
    expect(j.entries.slice(-2).map((e) => [e.idx, e.tag])).toEqual([[42, "0042_schema_migration_count"], [43, "0043_roster_locations"]])
    const s = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0043_snapshot.json", import.meta.url), "utf8")) as { prevId: string; id: string }
    const prev = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0042_snapshot.json", import.meta.url), "utf8")) as { id: string }
    expect(s.prevId).toBe(prev.id)
  })
})
