import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import pg from "pg"
import { afterAll, beforeEach, describe, expect, test } from "vitest"
import { ownerQuery } from "../../../test/db"
import { fakeClock, resetDb } from "../../../test/harness"
import { runJob } from "../../core/queue/queue"
import type { Deps } from "../../deps"
import { AUTO_REPEAT_JOB, registerRosters, repeatOne, runAutoRepeatJob, type Candidate } from "./jobs"
import { sites, type Json } from "./testkit"

// B8 Task 13: the auto-repeat sweep (FR-RS-28, R8-12): a draft `days` ahead of the next week, exactly once per (source week, target week), supervisors told once.

beforeEach(resetDb)

const SRC = "2026-12-07"
const NEXT = "2026-12-14"
type W = Awaited<ReturnType<typeof world>>
const world = (now = "2026-12-10T09:00:00.000Z") => sites({ clock: fakeClock(new Date(now)) })
const setClock = (w: W, at: string) => {
  const d = Date.parse(at) - w.clock.now().getTime()
  if (d < 0) throw new Error("the clock cannot go back")
  w.clock.advance({ minutes: d / 60_000 })
}
/** Alpha's published SRC week with the employee, Cian and an open shift, auto-repeating `days` ahead. */
async function due(w: W, days: number | null = 7, locationId = w.a, typeId = w.ta, people = [w.p.employee.userId, w.staff2.userId]) {
  const wk = await w.week(w.p.owner, locationId, SRC)
  await w.addOk(w.p.owner, wk, [{ date: SRC, userIds: [people[0], null], shiftTypeId: typeId }, { date: "2026-12-08", userIds: [people[1]], shiftTypeId: typeId }])
  const v = Number((await w.rows("select version from roster_weeks where id = $1", [wk]))[0].version)
  await w.ok("POST", `/v1/roster/weeks/${wk}/publish`, w.p.owner, { version: v })
  if (days !== null) await w.ok("PUT", `/v1/roster/weeks/${wk}/auto-repeat`, w.p.owner, { days })
  return wk
}
const run = (w: W, data: unknown = {}, workers = 1, deps: Deps = w.deps) => Promise.all(Array.from({ length: workers }, () => runAutoRepeatJob(data, deps)))
const drafts = (w: W, locationId = w.a, start = NEXT) => w.rows("select id, status, auto_repeat_days from roster_weeks where location_id = $1 and week_start = $2", [locationId, start])
const ledger = (w: W) => w.rows("select source_week_id, target_week_start::text as target, created_at from roster_auto_repeat_runs order by target_week_start")
const notes = (w: W) => w.rows("select user_id, title, body, kind, created_at from notifications where title = 'Roster draft ready' order by user_id")
const spy = () => {
  const lines: Json[] = []
  const mk = (level: string) => (o: unknown, m?: string) => void lines.push({ level, ...(o && typeof o === "object" ? (o as Json) : {}), msg: m ?? (typeof o === "string" ? o : undefined) })
  const l = { error: mk("error"), warn: mk("warn"), info: mk("info"), debug: mk("debug"), trace: mk("trace"), fatal: mk("fatal"), level: "debug" } as Json
  l.child = () => l
  return { logger: l as unknown as Deps["logger"], lines }
}

describe("auto-repeat sweep (R8-12)", () => {
  test("a due week gets exactly one draft (people and times, leave opened), the supervisors are told once with generic text; the office is not asked while a supervisor exists", async () => {
    const w = await world()
    const src = await due(w)
    const leave = await w.ok("POST", "/v1/leave", w.staff2, { from: "2026-12-15", to: "2026-12-15", kind: "annual", note: "" }, 201)
    await w.ok("POST", `/v1/leave/${leave.id}/decide`, w.p.owner, { decision: "approve", note: "" })
    await run(w)
    const [d] = await drafts(w)
    expect(d).toMatchObject({ status: "draft", auto_repeat_days: 7 })
    const shifts = await w.rows("select user_id, date::text as date, source_shift_id, created_by from roster_shifts where week_id = $1 order by date, user_id nulls last", [d.id])
    expect(shifts.map((s) => [s.date, s.user_id])).toEqual([[NEXT, w.p.employee.userId], [NEXT, null], ["2026-12-15", null]]) // Cian is on leave: an open shift
    expect(shifts.every((s) => s.source_shift_id !== null && s.created_by === "system:roster-auto-repeat")).toBe(true)
    expect(await ledger(w)).toEqual([expect.objectContaining({ source_week_id: src, target: NEXT })])
    const n = await notes(w)
    expect(n.map((x) => x.user_id)).toEqual([w.p["location-supervisor"].userId])
    expect(n[0].body).toBe(`A draft roster for the week starting ${NEXT} was created from the previous week. Review and publish it.`)
    for (const secret of ["Aoife", "Cian", "annual", w.a]) expect(JSON.stringify(n)).not.toContain(secret)
    const [h] = await w.rows("select actor_id, action, after from roster_history where action = 'week_auto_repeated'")
    expect(h).toMatchObject({ actor_id: "system:roster-auto-repeat", after: { sourceWeekId: src, weekStart: NEXT, shifts: 3, opened: 1 } })
    expect(await w.rows("select 1 from audit_events where action = 'roster.week_auto_repeated' and entity_id = $1", [d.id])).toHaveLength(1)
    expect(await w.rows("select 1 from domain_events where type = 'roster.week_published' and payload->>'weekStart' = $1", [NEXT])).toHaveLength(0) // a draft publishes nothing
  })

  test("with no supervisor at the site the office roles that cover it are told instead", async () => {
    const w = await world()
    await due(w, 7, w.b, w.tb, [w.staff3.userId, w.p.manager.userId]) // Bravo's supervisor is sup2
    await w.ok("PUT", `/v1/locations/${w.b}/supervisors`, w.p.owner, { userIds: [] })
    await run(w)
    const ids = (await notes(w)).map((x) => x.user_id)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).not.toContain(w.sup2.userId)
    expect(ids).toContain(w.p.owner.userId)
  })

  test("running the sweep twice, or three workers at once, creates one draft, one ledger row and one notification", async () => {
    const w = await world()
    await due(w)
    await run(w, {}, 3)
    await run(w)
    expect(await drafts(w)).toHaveLength(1)
    expect(await ledger(w)).toHaveLength(1)
    expect(await notes(w)).toHaveLength(1)
    expect((await w.rows("select count(*)::int n from roster_shifts where week_id = $1", [(await drafts(w))[0].id]))[0].n).toBe(3)
  })

  test("a week with auto_repeat_days null is skipped; so are an unpublished week, an archived location and a tenant without M1A (no draft, no ledger, no notification)", async () => {
    const w = await world()
    await due(w, null) // Alpha: off
    const draftOnly = await w.week(w.p.owner, w.b, SRC) // Bravo: a draft source is not repeated
    await w.ok("PUT", `/v1/roster/weeks/${draftOnly}/auto-repeat`, w.p.owner, { days: 7 })
    await run(w)
    expect(await drafts(w)).toHaveLength(0)
    expect(await drafts(w, w.b)).toHaveLength(0)
    // switch Alpha on, then archive it
    const wkA = (await w.rows("select id from roster_weeks where location_id = $1 and week_start = $2", [w.a, SRC]))[0].id
    await w.ok("PUT", `/v1/roster/weeks/${wkA}/auto-repeat`, w.p.owner, { days: 7 })
    await w.ok("POST", `/v1/locations/${w.a}/archive`, w.p.owner)
    await run(w)
    expect(await drafts(w)).toHaveLength(0)
    // the location is back in business but the tenant has lost the module
    await w.rows("update locations set archived_at = null where id = $1", [w.a])
    await w.rows("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1A', 'revoke', 'test', 'p', now())", [w.tenant.id])
    await run(w)
    expect(await drafts(w)).toHaveLength(0)
    expect(await ledger(w)).toHaveLength(0)
    expect(await notes(w)).toHaveLength(0)
    await w.rows("delete from module_overrides where tenant_id = $1", [w.tenant.id])
    await run(w)
    expect(await drafts(w)).toHaveLength(1) // and with the module back it is created
  })

  test("the sweep uses deps.clock: a frozen clock before the due day creates nothing, on the due day it creates one", async () => {
    const w = await world("2026-12-06T09:00:00.000Z") // next week starts 8 days ahead: not yet within 7
    await due(w, 7)
    await run(w)
    expect(await drafts(w)).toHaveLength(0)
    setClock(w, "2026-12-06T23:30:00.000Z")
    await run(w)
    expect(await drafts(w)).toHaveLength(0) // Dublin is still the 6th (UTC+0 in December)
    setClock(w, "2026-12-07T00:00:00.000Z")
    await run(w)
    expect(await drafts(w)).toHaveLength(1)
    expect((await ledger(w))[0].created_at.toISOString()).toBe("2026-12-07T00:00:00.000Z") // the fake clock's instant, never the database's
  })

  test("the due day is the location's own: at 11:30 UTC on 12 Dec it is already the 13th in Auckland (due, 1 day ahead) and still the 12th in Dublin (not yet)", async () => {
    const w = await world("2026-12-12T11:30:00.000Z")
    const loc = await w.ok("GET", `/v1/locations/${w.b}`, w.p.owner)
    await w.ok("PATCH", `/v1/locations/${w.b}`, w.p.owner, { version: loc.version, timeZone: "Pacific/Auckland" })
    await due(w, 1)
    await due(w, 1, w.b, w.tb, [w.staff3.userId, w.p.manager.userId])
    await run(w)
    expect(await drafts(w, w.a)).toHaveLength(0)
    expect(await drafts(w, w.b)).toHaveLength(1)
    setClock(w, "2026-12-13T00:00:00.000Z") // midnight in Dublin: the 13th there too
    await run(w)
    expect(await drafts(w, w.a)).toHaveLength(1)
  })

  test("a copy inherits the days but is a DRAFT, so the chain waits until the supervisor publishes it; then the next week is created (one per week, never a gap, never twice)", async () => {
    const w = await world()
    await due(w)
    await run(w)
    const [first] = await drafts(w)
    setClock(w, "2026-12-17T09:00:00.000Z")
    await run(w)
    expect(await drafts(w, w.a, "2026-12-21")).toHaveLength(0) // the 14 Dec week is still a draft
    await w.ok("POST", `/v1/roster/weeks/${first.id}/publish`, w.p["location-supervisor"], { version: Number((await w.rows("select version from roster_weeks where id = $1", [first.id]))[0].version) })
    await run(w, {}, 2)
    expect(await drafts(w, w.a, "2026-12-21")).toHaveLength(1)
    expect(await ledger(w)).toHaveLength(2)
  })

  test("a week that a person already made by hand is not repeated over: no ledger row, no notification and NO error (the job sees the week and moves on, it does not collide with the unique key)", async () => {
    const w = await world()
    await due(w)
    await w.week(w.p.owner, w.a, NEXT)
    const s = spy()
    await run(w, {}, 1, { ...w.deps, logger: s.logger })
    expect(s.lines.filter((l) => l.level === "error")).toEqual([])
    expect((await w.rows("select count(*)::int n from roster_shifts where location_id = $1 and week_id = (select id from roster_weeks where location_id = $1 and week_start = $2)", [w.a, NEXT]))[0].n).toBe(0)
    expect(await ledger(w)).toHaveLength(0)
    expect(await notes(w)).toHaveLength(0)
  })

  test("exactly once per (source week, target week) even when the draft is later removed: the LEDGER, not the existing week, is the arbiter (a removed draft is not made again)", async () => {
    const w = await world()
    await due(w)
    await run(w)
    const [d] = await drafts(w)
    await w.rows("delete from roster_shifts where week_id = $1", [d.id])
    await w.rows("delete from roster_weeks where id = $1", [d.id])
    await run(w, {}, 2)
    expect(await drafts(w)).toHaveLength(0)
    expect(await ledger(w)).toHaveLength(1)
    expect(await notes(w)).toHaveLength(1)
  })

  test("a later DRAFT week with auto-repeat on does not hide an earlier published week that is due (only published weeks are sources)", async () => {
    const w = await world()
    await due(w)
    const later = await w.week(w.p.owner, w.a, "2026-12-28")
    await w.ok("PUT", `/v1/roster/weeks/${later}/auto-repeat`, w.p.owner, { days: 60 }) // due too: it is the latest week of the site
    await run(w)
    expect(await drafts(w)).toHaveLength(1)
  })

  test("the plan is re-read under the lock: a stale candidate whose successor was made by hand, or whose source is no longer published, changes nothing (no ledger row, no draft, no notification)", async () => {
    const w = await world()
    const src = await due(w)
    const cand: Candidate = { id: src, locationId: w.a, weekStart: SRC, days: 7, zone: "Europe/Dublin" }
    const now = w.clock.now()
    await w.week(w.p.owner, w.a, NEXT) // somebody made the next week after the plan
    expect(await repeatOne(w.deps, w.tenant.id, "Europe/Dublin", cand, now)).toBe(false)
    expect(await ledger(w)).toHaveLength(0)
    await w.rows("delete from roster_weeks where location_id = $1 and week_start = $2", [w.a, NEXT])
    await w.rows("update roster_weeks set status = 'draft' where id = $1", [src]) // and the source lost its published state
    expect(await repeatOne(w.deps, w.tenant.id, "Europe/Dublin", cand, now)).toBe(false)
    await w.rows("update roster_weeks set status = 'published', auto_repeat_days = null where id = $1", [src]) // or its auto-repeat was switched off
    expect(await repeatOne(w.deps, w.tenant.id, "Europe/Dublin", cand, now)).toBe(false)
    expect(await ledger(w)).toHaveLength(0)
    expect(await drafts(w)).toHaveLength(0)
    expect(await notes(w)).toHaveLength(0)
    await w.rows("update roster_weeks set auto_repeat_days = 7 where id = $1", [src])
    expect(await repeatOne(w.deps, w.tenant.id, "Europe/Dublin", cand, now)).toBe(true) // the same call is the real thing once the state is right
    expect(await ledger(w)).toHaveLength(1)
  })

  test("bounded batches: `batch` weeks per tenant per run, the rest on the next run", async () => {
    const w = await world()
    await due(w)
    await due(w, 7, w.b, w.tb, [w.staff3.userId, w.p.manager.userId])
    await run(w, { batch: 1 })
    expect(await ledger(w)).toHaveLength(1)
    await run(w, { batch: 1 })
    expect(await ledger(w)).toHaveLength(2)
    await run(w, { batch: 1 })
    expect(await ledger(w)).toHaveLength(2)
  })

  test("a tenant that fails is logged with its id and a safe code only (no names, no SQL), nothing is half written, and the next run retries", async () => {
    const w = await world()
    await due(w)
    await ownerQuery(`create function fail_next_week() returns trigger language plpgsql as $$ begin if new.week_start = '${NEXT}' then raise exception 'Aoife Byrne secret'; end if; return new; end $$`)
    await ownerQuery("create trigger fail_next_week before insert on roster_weeks for each row execute function fail_next_week()")
    const s = spy()
    try {
      await run(w, {}, 1, { ...w.deps, logger: s.logger })
    } finally {
      await ownerQuery("drop trigger fail_next_week on roster_weeks")
      await ownerQuery("drop function fail_next_week()")
    }
    expect(await drafts(w)).toHaveLength(0)
    expect(await ledger(w)).toHaveLength(0) // the ledger row rolled back with the copy
    expect(await notes(w)).toHaveLength(0)
    const errors = s.lines.filter((l) => l.level === "error")
    expect(errors).toHaveLength(1)
    expect(Object.keys(errors[0]).sort()).toEqual(["errCode", "level", "msg", "tenantId"])
    expect(JSON.stringify(s.lines)).not.toMatch(/Aoife|Cian|secret|insert into/i)
    setClock(w, "2026-12-10T09:31:00.000Z") // the first failure backs the site off for 30 minutes
    await run(w)
    expect(await drafts(w)).toHaveLength(1)
  })

  // a trigger that makes the copy fail for the given locations (the chosen ones, or every one but `except`)
  const failFor = async (cond: string) => {
    await ownerQuery(`create function fail_next_week() returns trigger language plpgsql as $$ begin if new.week_start = '${NEXT}' and ${cond} then raise exception 'boom'; end if; return new; end $$`)
    await ownerQuery("create trigger fail_next_week before insert on roster_weeks for each row execute function fail_next_week()")
  }
  const healFor = async () => {
    await ownerQuery("drop trigger if exists fail_next_week on roster_weeks")
    await ownerQuery("drop function if exists fail_next_week()")
  }
  const failures = async (w: W, id: string) => (await w.rows("select auto_repeat_failures::int as n, auto_repeat_attempt_at from locations where id = $1", [id]))[0]

  test("a persistently failing location backs off (30 min, then 1 h, ...) instead of failing every 15 minutes forever; a healthy location is never held back; success clears the count", async () => {
    const w = await world()
    await due(w) // Alpha fails
    await due(w, 7, w.b, w.tb, [w.staff3.userId, w.p.manager.userId]) // Bravo is healthy
    await failFor(`new.location_id = '${w.a}'`)
    const attempts = async (at: number) => {
      setClock(w, new Date(Date.parse("2026-12-10T09:00:00.000Z") + at * 60_000).toISOString())
      const s = spy()
      await run(w, {}, 1, { ...w.deps, logger: s.logger })
      return s.lines.filter((l) => l.level === "error").length
    }
    try {
      expect(await attempts(0)).toBe(1) // first try fails
      expect((await failures(w, w.a)).n).toBe(1)
      expect(await drafts(w, w.b)).toHaveLength(1) // Bravo was done in the same run
      expect(await attempts(15)).toBe(0) // the next scheduled run: Alpha is backing off, no attempt
      expect(await attempts(30)).toBe(1) // 30 minutes after the failure: tried again
      expect((await failures(w, w.a)).n).toBe(2)
      expect(await attempts(45)).toBe(0)
      expect(await attempts(89)).toBe(0) // the second delay is 1 h
      expect(await attempts(90)).toBe(1)
      expect((await failures(w, w.a)).n).toBe(3)
    } finally {
      await healFor()
    }
    expect(await attempts(90 + 15)).toBe(0)
    expect(await attempts(90 + 120)).toBe(0) // the next delay (2 h) has passed and the copy works: no error
    expect(await drafts(w, w.a)).toHaveLength(1)
    expect((await failures(w, w.a)).n).toBe(0) // success resets the count
  })

  test("AG4: a week of a backed-off site made by hand (create, or a manual repeat) clears its failure count and back-off; another site's is untouched", async () => {
    const w = await world()
    await due(w)
    await due(w, 7, w.b, w.tb, [w.staff3.userId, w.p.manager.userId])
    await failFor(`new.location_id in ('${w.a}', '${w.b}')`)
    try {
      await run(w)
    } finally {
      await healFor()
    }
    expect([(await failures(w, w.a)).n, (await failures(w, w.b)).n]).toEqual([1, 1])
    await w.week(w.p.owner, w.a, NEXT) // somebody makes next week of Alpha by hand
    expect(await failures(w, w.a)).toMatchObject({ n: 0, auto_repeat_attempt_at: null })
    expect((await failures(w, w.b)).n).toBe(1) // Bravo still backs off
    // a manual repeat of Bravo's source clears Bravo's too
    const [src] = await w.rows("select id, version from roster_weeks where location_id = $1 and week_start = $2", [w.b, SRC])
    await w.ok("POST", `/v1/roster/weeks/${src.id}/repeat`, w.p.owner, { version: Number(src.version), weeks: 1 }, 201)
    expect(await failures(w, w.b)).toMatchObject({ n: 0, auto_repeat_attempt_at: null })
  })

  test("AH3: only a week the sweep would draft itself clears the back-off: an unrelated or far-away hand-made week of a backed-off site does not", async () => {
    const w = await world()
    await due(w)
    await failFor(`new.location_id = '${w.a}'`)
    try {
      await run(w)
    } finally {
      await healFor()
    }
    expect((await failures(w, w.a)).n).toBe(1)
    await w.week(w.p.owner, w.a, "2027-03-01") // months away, no auto-repeat source before it
    await w.week(w.p.owner, w.a, "2026-12-28") // NEXT+14: the week before it (2026-12-21) is no published source
    expect((await failures(w, w.a)).n).toBe(1)
    await w.week(w.p.owner, w.a, NEXT) // the week the sweep itself would draft
    expect(await failures(w, w.a)).toMatchObject({ n: 0, auto_repeat_attempt_at: null })
  })

  test("more than a batch of failing locations never starve a healthy one: candidates are ordered by last attempt, the failing ones back off", async () => {
    const w = await world()
    const GOOD = "ffffffff-ffff-4fff-8fff-ffffffffffff" // the largest id: last in a plain id order
    await w.rows(`insert into locations (id, tenant_id, name, created_at, updated_at) select case when g = 52 then '${GOOD}'::uuid else gen_random_uuid() end, $1, 'S' || g, now(), now() from generate_series(1, 52) g`, [w.tenant.id])
    await w.rows(`insert into roster_weeks (tenant_id, location_id, week_start, status, auto_repeat_days, published_at, created_at, updated_at) select tenant_id, id, '${SRC}', 'published', 7, now(), now(), now() from locations where name like 'S%'`)
    await failFor(`new.location_id <> '${GOOD}'`)
    try {
      await run(w) // 50 failing sites tried, the good one is not in the first 50 by id
      expect(await drafts(w, GOOD)).toHaveLength(0)
      await run(w) // the 50 are backing off: the 51st failing site and the good one are next
    } finally {
      await healFor()
    }
    expect(await drafts(w, GOOD)).toHaveLength(1)
  })

  test("a successful run drops the tenant's read-model cache (the new draft is in the attention feed within one read)", async () => {
    const w = await world()
    await due(w)
    const busted: string[] = []
    await run(w, {}, 1, { ...w.deps, readModelCache: { ...w.deps.readModelCache, bust: async (t: string) => void busted.push(t) } })
    expect(busted).toEqual([w.tenant.id])
    busted.length = 0
    await run(w, {}, 1, { ...w.deps, readModelCache: { ...w.deps.readModelCache, bust: async (t: string) => void busted.push(t) } })
    expect(busted).toEqual([]) // nothing created: nothing to drop
  })

  test("the job is registered (roster.auto-repeat), scheduled by the worker, takes the roster lock first and never reads the wall clock", async () => {
    const w = await world()
    await due(w)
    registerRosters()
    await runJob(AUTO_REPEAT_JOB, {}, w.deps)
    expect(await drafts(w)).toHaveLength(1)
    expect(AUTO_REPEAT_JOB).toBe("roster.auto-repeat")
    const src = readFileSync(new URL("./jobs.ts", import.meta.url), "utf8")
    expect(src).not.toMatch(/new Date\(\)|Date\.now\(/)
    expect(src).not.toMatch(/(^|[^.\w])now\(\)/m)
    expect(src).toMatch(/lockRoster\(tx, tenantId\)/)
    expect(src.indexOf("lockRoster(tx, tenantId)")).toBeLessThan(src.indexOf("copyWeek("))
    const worker = readFileSync(new URL("../../worker.ts", import.meta.url), "utf8")
    expect(worker).toMatch(/registerRosters\(\)/)
    expect(worker).toMatch(/upsertJobScheduler\(AUTO_REPEAT_JOB, \{ every: 15 \* 60_000 \}/)
  })
})

describe("migration 0047 SQL run for real", () => {
  const owner = new pg.Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL, max: 2 })
  afterAll(() => owner.end())
  const file = readFileSync(new URL("../../db/migrations/0047_roster_auto_repeat_backoff.sql", import.meta.url), "utf8")

  test("the real file replayed as app_owner WITHOUT tenant context over 3 tenants adds the two job-state columns (null, 0) and leaves every location as it was", async () => {
    const ids: string[] = []
    for (const label of ["A", "B", "C"]) {
      const id = randomUUID()
      await owner.query("insert into tenants (id, slug, name) values ($1, $2, $3)", [id, `r-${id.slice(0, 8)}`, label])
      const c = await owner.connect()
      try {
        await c.query("begin")
        await c.query("select set_config('app.tenant_id', $1, true)", [id])
        for (const n of ["One", "Two"]) await c.query("insert into locations (tenant_id, name, created_at, updated_at) values ($1, $2, now(), now())", [id, `${label}${n}`])
        await c.query("commit")
      } finally {
        c.release()
      }
      ids.push(id)
    }
    const c = await owner.connect()
    try {
      await c.query("begin") // rolled back
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("")
      await c.query("alter table locations drop column auto_repeat_attempt_at, drop column auto_repeat_failures") // the state before 0047
      for (const stmt of file.split("--> statement-breakpoint")) if (stmt.trim()) await c.query(stmt)
      expect(String((await c.query("select current_setting('app.tenant_id', true) as t")).rows[0].t ?? "")).toBe("")
      expect((await c.query("select column_name, is_nullable, column_default from information_schema.columns where table_name = 'locations' and column_name like 'auto_repeat_%' order by column_name")).rows).toEqual([
        { column_name: "auto_repeat_attempt_at", is_nullable: "YES", column_default: null },
        { column_name: "auto_repeat_failures", is_nullable: "NO", column_default: "0" },
      ])
      let seen = 0
      for (const id of ids) {
        await c.query("select set_config('app.tenant_id', $1, true)", [id])
        const rows = (await c.query("select auto_repeat_attempt_at, auto_repeat_failures from locations")).rows
        expect(rows).toEqual([{ auto_repeat_attempt_at: null, auto_repeat_failures: 0 }, { auto_repeat_attempt_at: null, auto_repeat_failures: 0 }])
        seen += rows.length
      }
      expect(seen).toBe(6)
      await c.query("select set_config('app.tenant_id', '', true)")
      expect((await c.query("select count(*)::int as n from locations")).rows[0].n).toBe(0) // FORCE RLS still hides every row with no tenant
    } finally {
      await c.query("rollback")
      c.release()
    }
  })

  test("the journal and the 0047 snapshot follow 0046", () => {
    const j = JSON.parse(readFileSync(new URL("../../db/migrations/meta/_journal.json", import.meta.url), "utf8")) as { entries: { idx: number; tag: string }[] }
    expect(j.entries.slice(46, 48).map((e) => [e.idx, e.tag])).toEqual([[46, "0046_leave_decision_note"], [47, "0047_roster_auto_repeat_backoff"]])
    const s = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0047_snapshot.json", import.meta.url), "utf8")) as { prevId: string }
    const prev = JSON.parse(readFileSync(new URL("../../db/migrations/meta/0046_snapshot.json", import.meta.url), "utf8")) as { id: string }
    expect(s.prevId).toBe(prev.id)
  })
})
