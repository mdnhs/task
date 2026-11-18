import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, describe, expect, test } from "vitest"

// B8 Task 3 (migration 0044): weeks, shifts, history, change requests, exchanges, leave, availability, templates, two ledgers, plus the Task 1+2 review riders.
const NEW_TABLES = ["roster_weeks", "roster_shifts", "roster_history", "roster_change_requests", "roster_exchanges", "leave_requests", "roster_availability", "roster_week_templates", "roster_auto_repeat_runs", "qualification_expiry_notices"]
const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL, max: 2 })
const app = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 })
afterAll(async () => {
  await owner.end()
  await app.end()
})

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

type Seed = { id: string; user: string; user2: string; location: string; type: string; week: string; shift: string }
/** A tenant with two members, a location, a shift type, a draft week (Monday 2027-03-01) and one shift (as app_owner, tenant context per tenant). */
async function seedTenant(label: string): Promise<Seed> {
  const id = randomUUID()
  const [user, user2] = [`u-${randomUUID()}`, `u-${randomUUID()}`]
  const s: Seed = { id, user, user2, location: randomUUID(), type: randomUUID(), week: randomUUID(), shift: randomUUID() }
  await owner.query("insert into tenants (id, slug, name) values ($1, $2, $3)", [id, `w-${id.slice(0, 8)}`, label])
  for (const u of [user, user2]) await owner.query(`insert into "user" (id, name, email) values ($1, $2, $3)`, [u, label, `${u}@example.test`])
  await tx(owner, id, async (c) => {
    const role = (await c.query("insert into roles (tenant_id, key, label, home, access) values ($1, 'staff', 'Staff', '/', '{}') returning id", [id])).rows[0].id
    for (const u of [user, user2]) await c.query("insert into memberships (tenant_id, user_id, role_id, joined_at) values ($1, $2, $3, now())", [id, u, role])
    await c.query("insert into locations (id, tenant_id, name, created_at, updated_at) values ($1, $2, 'Site', now(), now())", [s.location, id])
    await c.query("insert into shift_types (id, tenant_id, location_id, name, start_time, end_time, role, created_at, updated_at) values ($1, $2, $3, 'Day', '08:00', '16:00', 'Guard', now(), now())", [s.type, id, s.location])
    await c.query("insert into member_qualifications (tenant_id, user_id, type, created_at, updated_at) values ($1, $2, 'PSA licence', now(), now())", [id, user])
    await c.query("insert into roster_weeks (id, tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, $3, '2027-03-01', now(), now())", [s.week, id, s.location])
    await insertShift(c, s, s.shift, user)
    await c.query("insert into roster_history (tenant_id, week_id, location_id, shift_id, action, actor_id, created_at) values ($1, $2, $3, $4, 'shift.created', $5, now())", [id, s.week, s.location, s.shift, user])
    await c.query("insert into roster_availability (tenant_id, user_id, weekday, from_time, to_time) values ($1, $2, 1, '09:00', '12:00')", [id, user])
    await c.query("insert into leave_requests (tenant_id, user_id, from_date, to_date, kind, created_at, updated_at) values ($1, $2, '2027-03-02', '2027-03-03', 'annual', now(), now())", [id, user])
    await c.query("insert into roster_week_templates (tenant_id, location_id, name, created_at, updated_at) values ($1, $2, 'Standard', now(), now())", [id, s.location])
    await c.query("insert into roster_auto_repeat_runs (tenant_id, source_week_id, target_week_start, created_at) values ($1, $2, '2027-03-08', now())", [id, s.week])
    await c.query("insert into qualification_expiry_notices (tenant_id, user_id, type, expires_on, lead_days, created_at) values ($1, $2, 'PSA licence', '2027-06-01', 30, now())", [id, user])
  })
  return s
}

const insertShift = (c: pg.PoolClient, s: Seed, id: string, user: string | null, startAt = "2027-03-01T08:00Z", endAt = "2027-03-01T16:00Z", extra: { source?: string } = {}) =>
  c.query(
    "insert into roster_shifts (id, tenant_id, week_id, location_id, date, user_id, shift_type_id, role, start_time, end_time, start_at, end_at, source_shift_id, created_at, updated_at) values ($1, $2, $3, $4, '2027-03-01', $5, $6, 'Guard', '08:00', '16:00', $7, $8, $9, now(), now())",
    [id, s.id, s.week, s.location, user, s.type, startAt, endAt, extra.source ?? null],
  )

describe("migration 0044 tables", () => {
  test("every new table has RLS enabled and FORCED and the tenant_isolation policy (catalog query)", async () => {
    const rows = (await owner.query("select c.relname, c.relrowsecurity, c.relforcerowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname and p.policyname = 'tenant_isolation') as pol from pg_class c where c.relname = any($1) and c.relkind = 'r' order by 1", [NEW_TABLES])).rows
    expect(rows.map((r) => r.relname)).toEqual([...NEW_TABLES].sort())
    for (const r of rows) expect([r.relname, r.relrowsecurity, r.relforcerowsecurity, Number(r.pol)]).toEqual([r.relname, true, true, 1])
  })

  test("app_owner and app_user without tenant context see 0 rows of each new table; a cross-tenant insert is refused by WITH CHECK", async () => {
    const a = await seedTenant("A")
    const b = await seedTenant("B")
    for (const t of NEW_TABLES) {
      expect((await owner.query(`select count(*)::int as n from ${t}`)).rows[0].n).toBe(0)
      expect((await app.query(`select count(*)::int as n from ${t}`)).rows[0].n).toBe(0)
    }
    expect((await tx(app, a.id, (c) => c.query("select tenant_id from roster_shifts"))).rows.every((r) => r.tenant_id === a.id)).toBe(true)
    await expect(tx(app, a.id, (c) => c.query("insert into roster_week_templates (tenant_id, location_id, name, created_at, updated_at) values ($1, $2, 'X', now(), now())", [b.id, b.location]))).rejects.toMatchObject({ code: "42501" })
  })

  test("roster_weeks.week_start must be a Monday (CHECK)", async () => {
    const a = await seedTenant("A")
    const ins = (d: string) => tx(owner, a.id, (c) => c.query("insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, $3, now(), now())", [a.id, a.location, d]))
    await expect(ins("2027-03-09")).rejects.toMatchObject({ code: "23514" }) // a Tuesday
    await expect(ins("2027-03-14")).rejects.toMatchObject({ code: "23514" }) // a Sunday
    await ins("2027-03-15") // a Monday
  })

  test("a second week for the same location and start is refused (unique); another location may have it; status and repeat checks", async () => {
    const a = await seedTenant("A")
    await expect(tx(owner, a.id, (c) => c.query("insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, '2027-03-01', now(), now())", [a.id, a.location]))).rejects.toMatchObject({ code: "23505" })
    await tx(owner, a.id, async (c) => {
      const loc = randomUUID()
      await c.query("insert into locations (id, tenant_id, name, created_at, updated_at) values ($1, $2, 'Other', now(), now())", [loc, a.id])
      await c.query("insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, '2027-03-01', now(), now())", [a.id, loc])
    })
    await expect(tx(owner, a.id, (c) => c.query("update roster_weeks set status = 'open' where tenant_id = $1", [a.id]))).rejects.toMatchObject({ code: "23514" })
    await expect(tx(owner, a.id, (c) => c.query("update roster_weeks set auto_repeat_days = 0 where tenant_id = $1", [a.id]))).rejects.toMatchObject({ code: "23514" })
  })

  test("deleting a membership sets roster_shifts.user_id to NULL and keeps tenant_id (column-list SET NULL); a pending exchange's to_user_id likewise", async () => {
    const a = await seedTenant("A")
    await tx(owner, a.id, async (c) => {
      await c.query("insert into roster_exchanges (tenant_id, kind, shift_id, from_user_id, to_user_id, created_at, updated_at) values ($1, 'swap', $2, $3, $4, now(), now())", [a.id, a.shift, a.user, a.user2])
      await c.query("delete from memberships where tenant_id = $1 and user_id = $2", [a.id, a.user2])
      expect((await c.query("select to_user_id, tenant_id from roster_exchanges")).rows).toEqual([{ to_user_id: null, tenant_id: a.id }])
      await c.query("delete from memberships where tenant_id = $1 and user_id = $2", [a.id, a.user])
      expect((await c.query("select user_id, tenant_id from roster_shifts")).rows).toEqual([{ user_id: null, tenant_id: a.id }])
      // the person's own requests, availability, leave and notices go with them; the shift, week and history stay
      for (const t of ["roster_exchanges", "roster_availability", "leave_requests", "qualification_expiry_notices"]) expect((await c.query(`select count(*)::int as n from ${t}`)).rows[0].n).toBe(0)
      for (const t of ["roster_weeks", "roster_shifts", "roster_history"]) expect((await c.query(`select count(*)::int as n from ${t}`)).rows[0].n).toBe(1)
    })
  })

  test("end_at must be after start_at; times, break and role checks", async () => {
    const a = await seedTenant("A")
    const run = (start: string, end: string) => tx(owner, a.id, (c) => insertShift(c, a, randomUUID(), null, start, end))
    await expect(run("2027-03-01T16:00Z", "2027-03-01T16:00Z")).rejects.toMatchObject({ code: "23514" })
    await expect(run("2027-03-01T16:00Z", "2027-03-01T08:00Z")).rejects.toMatchObject({ code: "23514" })
    await run("2027-03-01T22:00Z", "2027-03-02T06:00Z") // overnight is fine
    await expect(tx(owner, a.id, (c) => c.query("update roster_shifts set start_time = '8:00' where tenant_id = $1", [a.id]))).rejects.toMatchObject({ code: "23514" })
    await expect(tx(owner, a.id, (c) => c.query("update roster_shifts set unpaid_break_min = 481 where tenant_id = $1", [a.id]))).rejects.toMatchObject({ code: "23514" })
  })

  test("composite FKs refuse another tenant's week, location, shift type and source shift; a week or type in use cannot be deleted", async () => {
    const a = await seedTenant("A")
    const b = await seedTenant("B")
    const bad = (over: Partial<Seed>) => tx(owner, a.id, (c) => insertShift(c, { ...a, ...over }, randomUUID(), null))
    await expect(bad({ week: b.week })).rejects.toMatchObject({ code: "23503" })
    await expect(bad({ location: b.location })).rejects.toMatchObject({ code: "23503" })
    await expect(bad({ type: b.type })).rejects.toMatchObject({ code: "23503" })
    await expect(tx(owner, a.id, (c) => insertShift(c, a, randomUUID(), null, undefined, undefined, { source: b.shift }))).rejects.toMatchObject({ code: "23503" })
    await expect(tx(owner, a.id, (c) => c.query("delete from roster_weeks where id = $1", [a.week]))).rejects.toMatchObject({ code: "23503" })
    await expect(tx(owner, a.id, (c) => c.query("delete from shift_types where id = $1", [a.type]))).rejects.toMatchObject({ code: "23503" })
    // deleting a source shift clears only source_shift_id
    await tx(owner, a.id, async (c) => {
      const copy = randomUUID()
      await insertShift(c, a, copy, null, "2027-03-02T08:00Z", "2027-03-02T16:00Z", { source: a.shift })
      await c.query("delete from roster_shifts where id = $1", [a.shift])
      expect((await c.query("select source_shift_id, tenant_id from roster_shifts where id = $1", [copy])).rows).toEqual([{ source_shift_id: null, tenant_id: a.id }])
    })
  })

  test("a change request carries the shift version it was made against (NOT NULL); a shift cannot name another location than its week's (composite FK)", async () => {
    const a = await seedTenant("A")
    await expect(tx(owner, a.id, (c) => c.query("insert into roster_change_requests (tenant_id, shift_id, requested_by, patch, reason, created_at, updated_at) values ($1, $2, $3, '{}', 'x', now(), now())", [a.id, a.shift, a.user]))).rejects.toMatchObject({ code: "23502" })
    await tx(owner, a.id, async (c) => {
      const other = randomUUID() // a second site of the SAME tenant, with its own shift type
      await c.query("insert into locations (id, tenant_id, name, created_at, updated_at) values ($1, $2, 'Other', now(), now())", [other, a.id])
      await c.query("savepoint s")
      await expect(insertShift(c, { ...a, location: other }, randomUUID(), null)).rejects.toMatchObject({ code: "23503" }) // week is Site's, shift says Other
      await c.query("rollback to savepoint s")
      await insertShift(c, a, randomUUID(), null) // week and location agree
    })
  })

  test("the added lookup indexes exist", async () => {
    const names = ["roster_exchanges_from_idx", "roster_exchanges_to_idx", "roster_change_requests_user_idx", "leave_requests_status_idx"]
    const rows = (await owner.query("select indexname from pg_indexes where indexname = any($1)", [names])).rows.map((r) => r.indexname)
    expect(rows.sort()).toEqual([...names].sort())
  })

  test("a second open exchange for the same shift and requester is refused, a decided one does not block a new one", async () => {
    const a = await seedTenant("A")
    const ins = (c: pg.PoolClient, kind = "claim", from = a.user, status = "requested") => c.query("insert into roster_exchanges (tenant_id, kind, shift_id, from_user_id, status, created_at, updated_at) values ($1, $2, $3, $4, $5, now(), now())", [a.id, kind, a.shift, from, status])
    await tx(owner, a.id, (c) => ins(c))
    await expect(tx(owner, a.id, (c) => ins(c))).rejects.toMatchObject({ code: "23505" })
    await expect(tx(owner, a.id, (c) => ins(c, "claim", a.user, "recommended"))).rejects.toMatchObject({ code: "23505" }) // recommended is still open
    await tx(owner, a.id, async (c) => {
      await ins(c, "swap") // another kind
      await ins(c, "claim", a.user2) // another requester
    })
    await tx(owner, a.id, async (c) => {
      await c.query("update roster_exchanges set status = 'rejected' where tenant_id = $1 and kind = 'claim' and from_user_id = $2", [a.id, a.user])
      await ins(c) // the decided one frees the slot
      await ins(c, "claim", a.user, "cancelled")
    })
    await expect(tx(owner, a.id, (c) => ins(c, "trade"))).rejects.toMatchObject({ code: "23514" })
    await expect(tx(owner, a.id, (c) => ins(c, "claim", a.user, "pending"))).rejects.toMatchObject({ code: "23514" })
  })

  test("change requests, leave and availability checks; a shift delete takes its requests and exchanges with it", async () => {
    const a = await seedTenant("A")
    await tx(owner, a.id, async (c) => {
      await c.query("insert into roster_change_requests (tenant_id, shift_id, shift_version, requested_by, patch, reason, created_at, updated_at) values ($1, $2, 1, $3, '{\"startTime\":\"09:00\"}', 'dentist', now(), now())", [a.id, a.shift, a.user])
      await expect(c.query("savepoint s").then(() => c.query("update roster_change_requests set status = 'maybe'"))).rejects.toMatchObject({ code: "23514" })
      await c.query("rollback to savepoint s")
      await c.query("delete from roster_shifts where id = $1", [a.shift])
      expect((await c.query("select count(*)::int as n from roster_change_requests")).rows[0].n).toBe(0)
    })
    await expect(tx(owner, a.id, (c) => c.query("insert into leave_requests (tenant_id, user_id, from_date, to_date, kind, created_at, updated_at) values ($1, $2, '2027-03-05', '2027-03-04', 'annual', now(), now())", [a.id, a.user]))).rejects.toMatchObject({ code: "23514" })
    await tx(owner, a.id, (c) => c.query("insert into leave_requests (tenant_id, user_id, from_date, to_date, kind, created_at, updated_at) values ($1, $2, '2027-03-05', '2027-03-05', 'annual', now(), now())", [a.id, a.user])) // one day
    const av = (w: number, f: string, t: string) => tx(owner, a.id, (c) => c.query("insert into roster_availability (tenant_id, user_id, weekday, from_time, to_time) values ($1, $2, $3, $4, $5)", [a.id, a.user, w, f, t]))
    await expect(av(7, "09:00", "10:00")).rejects.toMatchObject({ code: "23514" })
    await expect(av(2, "10:00", "09:00")).rejects.toMatchObject({ code: "23514" }) // overnight must be two rows
    await expect(av(2, "09:00", "09:00")).rejects.toMatchObject({ code: "23514" })
    await av(2, "22:00", "24:00")
    await av(3, "00:00", "06:00")
    await expect(av(2, "22:00", "24:00")).rejects.toMatchObject({ code: "23505" })
  })

  test("templates are unique per location and name; shifts must be an array; ledger tables refuse a duplicate key", async () => {
    const a = await seedTenant("A")
    await expect(tx(owner, a.id, (c) => c.query("insert into roster_week_templates (tenant_id, location_id, name, created_at, updated_at) values ($1, $2, 'Standard', now(), now())", [a.id, a.location]))).rejects.toMatchObject({ code: "23505" })
    await expect(tx(owner, a.id, (c) => c.query("update roster_week_templates set shifts = '{}'::jsonb where tenant_id = $1", [a.id]))).rejects.toMatchObject({ code: "23514" })
    await expect(tx(owner, a.id, (c) => c.query("insert into roster_auto_repeat_runs (tenant_id, source_week_id, target_week_start, created_at) values ($1, $2, '2027-03-08', now())", [a.id, a.week]))).rejects.toMatchObject({ code: "23505" })
    await expect(tx(owner, a.id, (c) => c.query("insert into qualification_expiry_notices (tenant_id, user_id, type, expires_on, lead_days, created_at) values ($1, $2, 'PSA licence', '2027-06-01', 30, now())", [a.id, a.user]))).rejects.toMatchObject({ code: "23505" })
    await tx(owner, a.id, async (c) => {
      await c.query("insert into roster_auto_repeat_runs (tenant_id, source_week_id, target_week_start, created_at) values ($1, $2, '2027-03-15', now())", [a.id, a.week]) // another target
      await c.query("insert into qualification_expiry_notices (tenant_id, user_id, type, expires_on, lead_days, created_at) values ($1, $2, 'PSA licence', '2027-06-01', 7, now())", [a.id, a.user]) // another lead
    })
  })

  test("riders: shift type names are unique per location case-insensitively among active rows; member_qualifications has the (tenant_id, file_id) index", async () => {
    const a = await seedTenant("A")
    const ins = (name: string, archived = false) => tx(owner, a.id, (c) => c.query(`insert into shift_types (tenant_id, location_id, name, start_time, end_time, role, archived_at, created_at, updated_at) values ($1, $2, $3, '08:00', '16:00', 'Guard', ${archived ? "now()" : "null"}, now(), now())`, [a.id, a.location, name]))
    await expect(ins("day")).rejects.toMatchObject({ code: "23505" }) // "Day" exists
    await expect(ins("DAY")).rejects.toMatchObject({ code: "23505" })
    await ins("Day", true) // an archived duplicate is free
    await ins("Night")
    const idx = (await owner.query("select indexdef from pg_indexes where indexname in ('member_qualifications_file_idx', 'shift_types_location_name_uq') order by indexname")).rows.map((r) => r.indexdef as string)
    expect(idx[0]).toContain("(tenant_id, file_id)")
    expect(idx[1]).toContain("lower(name)")
  })
})

describe("migration 0044 SQL run for real", () => {
  const file = readFileSync(new URL("../../db/migrations/0044_roster_weeks.sql", import.meta.url), "utf8")

  test("the real file replayed as app_owner WITHOUT tenant context over seeded data of 3 tenants: tables, FORCE RLS, riders; the 0043 data is untouched and app.tenant_id stays empty", async () => {
    const seeds = [await seedTenant("A"), await seedTenant("B"), await seedTenant("C")]
    const c = await owner.connect()
    try {
      await c.query("begin") // rolled back: nothing of this test stays
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("") // the migrator has no tenant context
      // The state before 0044: the new tables gone, the old index and no file index. FORCE RLS: the owner sees nothing without context, so DDL only here.
      for (const t of [...NEW_TABLES].reverse()) await c.query(`drop table ${t} cascade`)
      await c.query("drop index shift_types_location_name_uq")
      await c.query("create unique index shift_types_location_name_uq on shift_types (tenant_id, location_id, name) where archived_at is null")
      await c.query("drop index member_qualifications_file_idx")
      for (const stmt of file.split("--> statement-breakpoint")) if (stmt.trim()) await c.query(stmt)
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("") // nothing in the file sets a tenant
      for (const t of NEW_TABLES) expect((await c.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = $1", [t])).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true })
      // the file's checks bite on the re-created tables, and each tenant's 0043 rows are intact (per tenant, with that tenant's context)
      for (const s of seeds) {
        await c.query("select set_config('app.tenant_id', $1, true)", [s.id])
        expect((await c.query("select count(*)::int as n from shift_types")).rows[0].n).toBe(1)
        expect((await c.query("select count(*)::int as n from member_qualifications")).rows[0].n).toBe(1)
        expect((await c.query("select count(*)::int as n from roster_shifts")).rows[0].n).toBe(0)
        await c.query("savepoint sp")
        await expect(c.query("insert into roster_weeks (tenant_id, location_id, week_start, created_at, updated_at) values ($1, $2, '2027-03-02', now(), now())", [s.id, s.location])).rejects.toMatchObject({ code: "23514" })
        await c.query("rollback to savepoint sp")
        await c.query("savepoint sp")
        await expect(c.query("insert into shift_types (tenant_id, location_id, name, start_time, end_time, role, created_at, updated_at) values ($1, $2, 'DAY', '08:00', '16:00', 'Guard', now(), now())", [s.id, s.location])).rejects.toMatchObject({ code: "23505" })
        await c.query("rollback to savepoint sp")
      }
      await c.query("select set_config('app.tenant_id', '', true)")
      expect((await c.query("select count(*)::int as n from roster_weeks")).rows[0].n).toBe(0) // no context, no rows
      const idx = (await c.query("select indexdef from pg_indexes where indexname in ('member_qualifications_file_idx', 'shift_types_location_name_uq') order by indexname")).rows.map((r) => r.indexdef as string)
      expect(idx[0]).toContain("(tenant_id, file_id)")
      expect(idx[1]).toContain("lower(name)")
    } finally {
      await c.query("rollback")
      c.release()
    }
  })

  test("the journal and the 0044 snapshot follow 0043", () => {
    const j = JSON.parse(readFileSync(new URL("../../db/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: { idx: number; tag: string }[] }
    expect(j.entries.slice(43, 45).map((e) => [e.idx, e.tag])).toEqual([[43, "0043_roster_locations"], [44, "0044_roster_weeks"]]) // position-based: later migrations append
    const s = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0044_snapshot.json", import.meta.url), "utf8")) as { prevId: string }
    const prev = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0043_snapshot.json", import.meta.url), "utf8")) as { id: string }
    expect(s.prevId).toBe(prev.id)
  })
})
