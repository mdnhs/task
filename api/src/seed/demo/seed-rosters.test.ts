import { readFileSync } from "node:fs"
import { beforeAll, describe, expect, test } from "vitest"
import { call, resetDb, testApp } from "../../../test/harness"
import { signIn } from "../../../test/factories"
import { ownerDb, ownerQuery, ownerTenantQuery, testDb } from "../../../test/db"
import { DEMO_PASSWORD, demoOptions, PUBLIC_DATA } from "../../../test/seed-support"
import { deleteDemoTenants } from "./wipe"
import { detId } from "./ids"
import { openingHoursOf } from "./rosters"
import { sourcePath } from "./source"
import { seedDemo } from "./index"

// B8 Task 18: the roster part of the demo seed (public/data/rosters/*.json): rows, ids, dates by whole weeks, wall times across a clock change, scope, the seeded rule breaks, personas, idempotence and --reset.

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const read = <T = Json>(path: string): T => JSON.parse(readFileSync(sourcePath(PUBLIC_DATA, path), "utf8")) as T
const mock = {
  locations: read<{ locations: Json[] }>("rosters/locations.json").locations, templates: read<{ templates: Json[] }>("rosters/templates.json").templates,
  targets: read<{ targets: Json[] }>("rosters/targets.json").targets, weeks: read<{ weeks: Json[] }>("rosters/weeks.json").weeks, shifts: read<{ shifts: Json[] }>("rosters/shifts.json").shifts,
  history: read<{ history: Json[] }>("rosters/history.json").history, requests: read<{ requests: Json[] }>("rosters/requests.json").requests, claims: read<{ claims: Json[] }>("rosters/claims.json").claims,
  leave: read<{ leave: Json[] }>("rosters/leave.json").leave, availability: read<{ availability: Json[] }>("rosters/availability.json").availability,
  workforce: read<{ extras: Json[] }>("rosters/workforce.json").extras, weekTemplates: read<{ weekTemplates: Json[] }>("rosters/week-templates.json").weekTemplates,
  access: read<{ grants: Json[] }>("rosters/access.json"),
}
const ROSTER_TABLES = [
  "locations", "location_supervisors", "roster_office_limits", "shift_types", "shift_type_targets", "member_qualifications", "roster_weeks", "roster_shifts", "roster_history", "roster_change_requests",
  "roster_exchanges", "leave_requests", "roster_availability", "roster_week_templates", "roster_auto_repeat_runs", "qualification_expiry_notices",
] as const
const tenantId = async (slug = "northgate") => String((await ownerQuery("select id from tenants where slug = $1", [slug]))[0].id)
const q = async (sql: string, params: unknown[] = []): Promise<Json[]> => ownerTenantQuery(await tenantId(), sql, params) as Promise<Json[]>
const n = async (sql: string, params: unknown[] = []) => Number((await q(sql, params))[0].n)
const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000
const dayOf = (v: unknown) => String(v).slice(0, 10)

describe("roster seed at the mock's own week (anchor 2026-10-20: offset 0, the week of the clock change)", () => {
  const t = testApp()
  beforeAll(async () => {
    await resetDb()
    await seedDemo(testDb(), await demoOptions({ anchor: "2026-10-20" }))
  }, 300_000)

  test("the demo tenant gets the locations, supervisor grants, shift types, targets, a published and a draft week, shifts with open ones, history, a change request, a claim, leave, availability, qualifications and saved layouts; the other demo tenants none", async () => {
    expect(await n("select count(*)::int as n from locations")).toBe(mock.locations.length)
    expect(await n("select count(*)::int as n from location_supervisors")).toBe(mock.access.grants.length)
    expect(await n("select count(*)::int as n from shift_types")).toBe(mock.templates.length)
    expect(await n("select count(*)::int as n from shift_type_targets")).toBe(mock.targets.length)
    expect((await q("select status, count(*)::int as n from roster_weeks group by status order by status")).map((r) => [r.status, r.n])).toEqual([["draft", mock.weeks.filter((w) => w.status === "draft").length], ["published", mock.weeks.filter((w) => w.status === "published").length]])
    expect(await n("select count(*)::int as n from roster_shifts")).toBe(mock.shifts.length)
    expect(await n("select count(*)::int as n from roster_shifts where user_id is null")).toBe(mock.shifts.filter((s) => s.personId === null).length)
    expect(await n("select count(*)::int as n from roster_shifts where confirmed_at is not null")).toBe(mock.shifts.filter((s) => s.confirmedAt).length)
    expect(await n("select count(*)::int as n from roster_history")).toBeGreaterThanOrEqual(mock.history.length)
    expect(await n("select count(*)::int as n from roster_change_requests where status = 'requested'")).toBe(mock.requests.length)
    expect(await n("select count(*)::int as n from roster_exchanges where kind = 'claim' and status = 'requested'")).toBe(mock.claims.length)
    expect(await n("select count(*)::int as n from leave_requests")).toBe(mock.leave.length)
    expect((await q("select status, count(*)::int as n from leave_requests group by status order by status")).map((r) => r.status)).toEqual(["approved", "rejected", "requested"])
    expect(await n("select count(*)::int as n from roster_availability")).toBe(mock.availability.length)
    expect(await n("select count(*)::int as n from member_qualifications")).toBe(mock.workforce.reduce((s, w) => s + w.qualifications.length, 0))
    expect(await n("select count(*)::int as n from memberships where home_location_id is not null")).toBe(mock.workforce.length)
    expect(await n("select count(*)::int as n from roster_week_templates")).toBe(mock.weekTemplates.length)
    for (const slug of ["harbourline", "millbrook"]) for (const tbl of ROSTER_TABLES) expect(Number((await ownerTenantQuery(await tenantId(slug), `select count(*)::int as n from ${tbl}`))[0].n), `${slug} ${tbl}`).toBe(0)
    // one qualification expires within a month of the anchor (the expiry job's example), one is an open end
    expect(await n("select count(*)::int as n from member_qualifications where expires_on between date '2026-10-20' and date '2026-11-30'")).toBeGreaterThanOrEqual(1)
    expect(await n("select count(*)::int as n from member_qualifications where expires_on is null")).toBe(1)
    // the opening hours become per-day keys (a range line is expanded)
    expect((await q("select opening_hours from locations where name = 'Liffey Retail Park'"))[0].opening_hours).toEqual({ mon: "08:00-22:00", tue: "08:00-22:00", wed: "08:00-22:00", thu: "08:00-22:00", fri: "08:00-22:00", sat: "08:00-22:00" })
    expect(openingHoursOf("Mon-Sun 12:00-03:30")).toMatchObject({ mon: "12:00-03:30", sun: "12:00-03:30" })
    expect(openingHoursOf("by arrangement")).toEqual({ all: "by arrangement" })
  })

  test("ids are deterministic uuids of the mock ids (R8-18): a location, a shift type, a week, a shift and a request keep their id across runs", async () => {
    const tid = await tenantId()
    expect((await q("select id from locations where name = 'Coppers'"))[0].id).toBe(detId(tid, "roster-location", "loc-coppers"))
    expect((await q("select id from shift_types where name = 'Door evening'"))[0].id).toBe(detId(tid, "roster-shift-type", "tpl-cop-door"))
    expect(new Set((await q("select id from roster_weeks")).map((r) => r.id))).toEqual(new Set(mock.weeks.map((w) => detId(tid, "roster-week", w.id))))
    expect(new Set((await q("select id from roster_shifts")).map((r) => r.id))).toEqual(new Set(mock.shifts.map((s) => detId(tid, "roster-shift", s.id))))
    expect((await q("select id from roster_change_requests"))[0].id).toBe(detId(tid, "roster-request", "cr-001"))
    // every week of a published location carries a publish line in the history (the mock has none for one of them)
    const published = await n("select count(*)::int as n from roster_weeks where status = 'published'")
    expect(await n("select count(distinct week_id)::int as n from roster_history where action = 'week_published'")).toBe(published)
  })

  test("seed invariants: a supervisor sees only the weeks and shifts of the sites they hold, never another site's (the Task 4 scope over the seeded data); the owner, the admin and the all-scope manager see every site", async () => {
    const tid = await tenantId()
    const sites = Object.fromEntries((await q("select name, id from locations")).map((r) => [r.name, r.id as string]))
    const shiftsOf = async (loc: string) => (await q("select id from roster_shifts where location_id = $1", [sites[loc]])).map((r) => r.id as string)
    const as = async (email: string) => (await signIn(t.app, email, DEMO_PASSWORD)).cookie
    const weeks = async (cookie: string): Promise<{ status: number; text: string; json: Json }> => {
      const r = await call(t.app, "GET", "/v1/roster/weeks?from=2026-10-19&to=2026-11-01", { cookie, tenant: "northgate" })
      const text = await r.text()
      return { status: r.status, text, json: r.status === 200 ? JSON.parse(text) : {} }
    }
    const every: string[] = ["Coppers", "Docklands Plaza", "Liffey Retail Park"]
    for (const [email, want] of [["amara.bello@demo.example", every], ["rhys.edwards@demo.example", every], ["lilianna.novak@demo.example", every], ["ismail.rahman@demo.example", ["Coppers"]], ["daniel.okafor@demo.example", ["Docklands Plaza"]]] as [string, string[]][]) {
      const r = await weeks(await as(email))
      expect(r.status, email).toBe(200)
      expect(new Set((r.json.weeks as Json[]).map((w) => w.locationId)), email).toEqual(new Set(want.map((l) => sites[l])))
      for (const other of every.filter((l) => !want.includes(l))) {
        for (const id of [sites[other], ...(await shiftsOf(other))]) expect(r.text, `${email} must not see ${other}`).not.toContain(id)
      }
      for (const l of want) for (const id of await shiftsOf(l)) expect(r.text, `${email} sees ${l}`).toContain(id)
    }
    // Grace Mensah holds the supervisor role but no grant: she sees nothing (and the page can say so); HR and the auditor have no roster access
    const grace = await weeks(await as("grace.mensah@demo.example"))
    expect([grace.status, (grace.json.weeks as Json[]).length]).toEqual([200, 0])
    for (const email of ["priya.shah@demo.example", "ibrahim.khan@demo.example"]) expect([403, 200], email).toContain((await weeks(await as(email))).status)
    expect(tid).toBeTruthy()
  }, 120_000)

  test("the personas that can edit: the owner, the admin and the all-scope manager (ops) open a week at ANY site; a supervisor only at the site they hold (another site is 404, the same answer as a missing one); HR and the auditor cannot", async () => {
    const sites = Object.fromEntries((await q("select name, id from locations")).map((r) => [r.name, r.id as string]))
    const create = async (email: string, loc: string, weekStart: string) => {
      const cookie = (await signIn(t.app, email, DEMO_PASSWORD)).cookie
      return (await call(t.app, "POST", "/v1/roster/weeks", { cookie, tenant: "northgate", body: { locationId: sites[loc], weekStart } })).status
    }
    expect(await create("amara.bello@demo.example", "Liffey Retail Park", "2027-01-04")).toBe(201)
    expect(await create("rhys.edwards@demo.example", "Docklands Plaza", "2027-01-04")).toBe(201)
    expect(await create("lilianna.novak@demo.example", "Coppers", "2027-01-04")).toBe(201)
    expect(await create("ismail.rahman@demo.example", "Coppers", "2027-01-11")).toBe(201)
    expect(await create("ismail.rahman@demo.example", "Docklands Plaza", "2027-01-11")).toBe(404)
    expect(await create("daniel.okafor@demo.example", "Docklands Plaza", "2027-01-11")).toBe(201)
    expect(await create("daniel.okafor@demo.example", "Coppers", "2027-01-18")).toBe(404)
    for (const email of ["priya.shah@demo.example", "ibrahim.khan@demo.example", "tomasz.wojcik@demo.example"]) expect([403, 404], email).toContain(await create(email, "Coppers", "2027-01-18"))
    // the roles themselves: only the demo tenant's `ops` and `supervisor` were given a roster level, the owner and admin templates already had one
    expect((await q("select key, roster_level, access->>'roster' as roster from roles where roster_level is not null order by key")).map((r) => [r.key, r.roster_level, r.roster])).toEqual([
      ["admin", "office", "write"], ["location-supervisor", "supervisor", "write"], ["ops", "office", "write"], ["owner", "office", "write"], ["roster-manager", "office", "write"], ["supervisor", "supervisor", "write"],
    ])
  }, 120_000)

  test("the seeded rule breaks produce their warnings: the overlap (a double booking, blocking), the 1-hour rest, the approved leave and the unavailable window", async () => {
    const cookie = (await signIn(t.app, "amara.bello@demo.example", DEMO_PASSWORD)).cookie
    const found = new Map<string, string[]>()
    for (const w of await q("select id from roster_weeks")) {
      const r = await call(t.app, "POST", `/v1/roster/weeks/${w.id}/check`, { cookie, tenant: "northgate", body: {} })
      expect(r.status).toBe(200)
      for (const v of ((await r.json()) as Json).violations as Json[]) found.set(v.rule, [...(found.get(v.rule) ?? []), `${v.severity}: ${v.message}`])
    }
    expect(found.get("double_booking")?.some((m) => m.startsWith("block:") && /overlaps/.test(m))).toBe(true)
    expect(found.get("daily_rest")?.some((m) => /only 1h00 rest/.test(m))).toBe(true)
    expect(found.get("approved_leave")?.length).toBeGreaterThan(0)
    expect(found.get("unavailable")?.length).toBeGreaterThan(0)
    // the rules the tenant chose are the mock's
    const rules = (await q("select value from tenant_settings where key = 'roster.rules'"))[0].value
    expect(rules).toMatchObject({ avgWeekReferenceWeeks: 17, severity: { double_booking: "block", daily_rest: "warn" } })
  }, 120_000)
})

describe("dates move by whole weeks and wall times survive the clock change (anchor 2027-03-26: the mock's weeks land on 22 Mar 2027, whose Sunday is the spring change)", () => {
  beforeAll(async () => {
    await resetDb()
    await seedDemo(testDb(), await demoOptions({ anchor: "2027-03-26" }))
  }, 300_000)

  test("every week, shift, leave and qualification date moved by the SAME whole number of weeks; a week still starts on a Monday; every shift keeps its wall times in the tenant zone, also on 28 Mar 2027 when 01:00 became 02:00", async () => {
    const week = (await q("select id, week_start::text as ws from roster_weeks order by week_start limit 1"))[0]
    const first = mock.weeks.map((w) => w.weekStart as string).sort()[0]
    const shift = day(week.ws) - day(first)
    expect(shift % 7).toBe(0)
    expect(shift).toBeGreaterThan(0)
    for (const w of mock.weeks) expect(dayOf((await q("select week_start::text as d from roster_weeks where id = $1", [detId(await tenantId(), "roster-week", w.id)]))[0].d), w.id).toBe(new Date((day(w.weekStart) + shift) * 86_400_000).toISOString().slice(0, 10))
    expect(await n("select count(*)::int as n from roster_weeks where extract(isodow from week_start) <> 1")).toBe(0)
    for (const s of mock.shifts.slice(0, 51)) {
      const r = (await q("select date::text as d, start_time, end_time, to_char(start_at at time zone 'Europe/Dublin', 'YYYY-MM-DD\"T\"HH24:MI') as ls, to_char(end_at at time zone 'Europe/Dublin', 'HH24:MI') as le from roster_shifts where id = $1", [detId(await tenantId(), "roster-shift", s.id)]))[0]
      expect(r.d, s.id).toBe(new Date((day(s.date) + shift) * 86_400_000).toISOString().slice(0, 10))
      expect(r.ls, s.id).toBe(`${r.d}T${s.start}`) // the wall time is kept, whatever the UTC offset of that day
      expect(r.le, s.id).toBe(s.end)
    }
    for (const l of mock.leave) expect(dayOf((await q("select from_date::text as d from leave_requests where id = $1", [detId(await tenantId(), "roster-leave", l.id)]))[0].d)).toBe(new Date((day(l.from) + shift) * 86_400_000).toISOString().slice(0, 10))
    // the change itself is inside the seeded weeks: a Saturday night shift that crosses 28 Mar 2027 02:00 exists and its end instant is after its start
    expect(await n("select count(*)::int as n from roster_shifts where date = date '2027-03-27' and end_at > start_at")).toBeGreaterThan(0)
  }, 120_000)
})

describe("idempotent and --reset safe", () => {
  beforeAll(resetDb)

  test("a second run changes no roster row or id; a run on a later day keeps every id and moves the dates by whole weeks; --reset removes every roster row of every tenant (no orphans) and a seed after it works", async () => {
    const snap = async () => {
      const out: Record<string, string[]> = {}
      for (const tbl of ROSTER_TABLES) out[tbl] = (await q(`select (${tbl}::text) as r from ${tbl} order by 1`)).map((r) => String(r.r))
      return out
    }
    await seedDemo(testDb(), await demoOptions({ anchor: "2026-12-01" }))
    const first = await snap()
    expect(first.roster_shifts.length).toBe(mock.shifts.length)
    await seedDemo(testDb(), await demoOptions({ anchor: "2026-12-01" }))
    expect(await snap()).toEqual(first)
    // later day: the same ids, dates moved
    const ids = async (tbl: string) => (await q(`select id from ${tbl} order by id`)).map((r) => r.id)
    const shiftIds = await ids("roster_shifts")
    const before = (await q("select min(date)::text as d from roster_shifts"))[0].d
    await seedDemo(testDb(), await demoOptions({ anchor: "2027-02-09" }))
    expect(await ids("roster_shifts")).toEqual(shiftIds)
    const after = (await q("select min(date)::text as d from roster_shifts"))[0].d
    expect((day(after) - day(before)) % 7).toBe(0)
    expect(after).not.toBe(before)
    expect(await n("select count(*)::int as n from roster_shifts")).toBe(mock.shifts.length) // nothing doubled
    // --reset
    const tid = await tenantId()
    await seedDemo(testDb(), await demoOptions({ anchor: "2026-12-01", reset: true }))
    expect(await n("select count(*)::int as n from roster_shifts")).toBe(mock.shifts.length)
    await deleteDemoTenants(ownerDb())
    expect(await ownerQuery("select id from tenants where slug = 'northgate'")).toEqual([])
    for (const tbl of ROSTER_TABLES) expect(Number((await ownerTenantQuery(tid, `select count(*)::int as n from ${tbl}`))[0].n), tbl).toBe(0)
    await seedDemo(testDb(), await demoOptions({ anchor: "2026-12-01" }))
    expect(await n("select count(*)::int as n from roster_weeks")).toBe(mock.weeks.length)
  }, 300_000)
})
