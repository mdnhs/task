import { beforeEach, describe, expect, test } from "vitest"
import { ownerQuery } from "../../../test/db"
import { resetDb } from "../../../test/harness"
import { sites, type Json, type Who } from "./testkit"

// B8 Task 13: repeat a published week (FR-RS-26..28, AC-RS-06, R8-12), saved week templates (FR-RS-29), the auto-repeat setting. The auto-repeat JOB is repeat-job.test.ts.

beforeEach(resetDb)

type W = Awaited<ReturnType<typeof sites>>
const SRC = "2026-12-07"
const T1 = "2026-12-14"
const T2 = "2026-12-21"
const T3 = "2026-12-28"
const version = async (w: W, weekId: string): Promise<number> => Number((await w.rows("select version from roster_weeks where id = $1", [weekId]))[0].version)
const publish = async (w: W, weekId: string, who: Who = w.p.owner): Promise<void> => void (await w.ok("POST", `/v1/roster/weeks/${weekId}/publish`, who, { version: await version(w, weekId) }))
const repeat = (w: W, who: Who, weekId: string, body: Json) => w.req("POST", `/v1/roster/weeks/${weekId}/repeat`, who, body)
const repeatOk = async (w: W, who: Who, weekId: string, body: Json): Promise<Json> => {
  const r = await repeat(w, who, weekId, { version: await version(w, weekId), weeks: 1, ...body })
  const text = await r.text()
  expect(r.status, text).toBe(201)
  return JSON.parse(text)
}
/** The versions of the existing target drafts of the next `n` weeks after the source, by Monday (what a client that looked at them sends). */
const tv = async (w: W, srcId: string, n: number): Promise<Record<string, number>> => {
  const [src] = await w.rows("select location_id, week_start::text as ws from roster_weeks where id = $1", [srcId])
  const out: Record<string, number> = {}
  for (let i = 1; i <= n; i++) {
    const d = new Date(`${src.ws}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + 7 * i)
    const day = d.toISOString().slice(0, 10)
    const [r] = await w.rows("select version from roster_weeks where location_id = $1 and week_start = $2", [src.location_id, day])
    if (r) out[day] = Number(r.version)
  }
  return out
}
const shiftsOf = (w: W, weekId: string) => w.rows("select id, date::text as date, user_id, start_time, end_time, start_at, end_at, source_shift_id, version, confirmed_at from roster_shifts where week_id = $1 order by date, start_time, id", [weekId])
const weekIdAt = async (w: W, locationId: string, start: string): Promise<string | undefined> => (await w.rows("select id from roster_weeks where location_id = $1 and week_start = $2", [locationId, start]))[0]?.id
/** Alpha's published SRC week: the employee on Monday, Cian (staff2) on Tuesday, the employee on Wednesday 09:00-15:00. */
async function coppers(w: W) {
  const wk = await w.week(w.p.owner, w.a, SRC)
  const a = await w.addOk(w.p.owner, wk, [{ date: SRC, userIds: [w.p.employee.userId], shiftTypeId: w.ta }, { date: "2026-12-08", userIds: [w.staff2.userId], shiftTypeId: w.ta }, { date: "2026-12-09", userIds: [w.p.employee.userId], shiftTypeId: w.ta, start: "09:00", end: "15:00" }])
  await publish(w, wk)
  return { wk, ids: (a.shifts as Json[]).map((s) => s.id as string) }
}
const leaveFor = async (w: W, who: Who, from: string, to: string) => {
  const l = await w.ok("POST", "/v1/leave", who, { from, to, kind: "annual", note: "" }, 201)
  await w.ok("POST", `/v1/leave/${l.id}/decide`, w.p.owner, { decision: "approve", note: "" })
}

describe("repeat (FR-RS-26, 27, AC-RS-06, R8-12)", () => {
  test("AC-RS-06: repeat of a published Coppers-style week creates a draft with the same people and times; a person on approved leave that week is an open shift plus a conflict row, not rostered", async () => {
    const w = await sites()
    const { wk, ids } = await coppers(w)
    await leaveFor(w, w.staff2, "2026-12-15", "2026-12-15")
    const events = async () => (await w.rows("select type from domain_events order by id")).map((e) => e.type)
    const eventsBefore = await events()
    const out = await repeatOk(w, w.p.owner, wk, { weeks: 1 })
    expect(out.created).toHaveLength(1)
    expect(out.created[0]).toMatchObject({ locationId: w.a, weekStart: T1, status: "draft", publishedAt: null, publishedBy: null })
    const rows = await shiftsOf(w, out.created[0].id)
    expect(rows.map((r) => [r.date, r.user_id, r.start_time, r.end_time])).toEqual([[T1, w.p.employee.userId, "08:00", "16:00"], ["2026-12-15", null, "08:00", "16:00"], ["2026-12-16", w.p.employee.userId, "09:00", "15:00"]])
    expect(rows.map((r) => r.source_shift_id)).toEqual(ids) // provenance: each copy points at its source shift
    expect(rows.every((r) => r.confirmed_at === null && r.version === 1)).toBe(true)
    expect(out.conflicts).toEqual([{ weekId: out.created[0].id, shiftId: rows[1].id, personId: w.staff2.userId, date: "2026-12-15", reason: "approved_leave", open: true, message: expect.any(String) }])
    expect(out.counts).toEqual({ copied: 3, kept: 2, warned: 0, opened: 1 })
    // a draft tells nobody and publishes nothing; the source week is untouched
    expect(await w.rows("select 1 from notifications where title ilike '%roster%' and created_at > '2026-11-16T09:00:00Z' and title <> 'Roster published'")).toHaveLength(0)
    expect(await events()).toEqual(eventsBefore) // no event of any kind: the copy is a draft
    expect((await w.rows("select status, version from roster_weeks where id = $1", [wk]))[0]).toMatchObject({ status: "published" })
    const [h] = await w.rows("select action, week_id, location_id, after from roster_history where action = 'week_repeated'")
    expect(h).toMatchObject({ week_id: out.created[0].id, location_id: w.a, after: { sourceWeekId: wk, shifts: 3, kept: 2, warned: 0, opened: 1 } })
    expect(await w.rows("select 1 from audit_events where action = 'roster.week_repeated' and entity_id = $1", [out.created[0].id])).toHaveLength(1)
  })

  test("Review Focus 5: every copied shift is kept, kept with a warn conflict (open false), or open with a conflict (open true); counts add up: copied = kept + warned + opened", async () => {
    const w = await sites()
    const wk = await w.week(w.p.owner, w.a, SRC)
    await w.addOk(w.p.owner, wk, [
      { date: SRC, userIds: [w.p.employee.userId, null], shiftTypeId: w.ta }, // clean, and an open shift that stays open without a conflict
      { date: "2026-12-08", userIds: [w.staff2.userId], shiftTypeId: w.ta }, // approved leave: opened
      { date: "2026-12-09", userIds: [w.staff3.userId], shiftTypeId: w.ta }, // unavailable (a warn): kept with a conflict
      { date: "2026-12-10", userIds: [w.p.employee.userId], shiftTypeId: w.ta }, // public holiday: kept with an info line
    ])
    await publish(w, wk)
    await leaveFor(w, w.staff2, "2026-12-15", "2026-12-15")
    await w.ok("PUT", "/v1/roster/availability", w.staff3, { windows: [{ weekday: 3, from: "09:00", to: "12:00" }] }) // Wednesday 16 Dec
    await w.rows("insert into public_holidays (tenant_id, date, name) values ($1, '2026-12-17', 'Bank holiday')", [w.tenant.id])
    const out = await repeatOk(w, w.p.owner, wk, {})
    expect(out.counts).toEqual({ copied: 5, kept: 2, warned: 2, opened: 1 })
    expect(out.counts.copied).toBe(out.counts.kept + out.counts.warned + out.counts.opened)
    const rows = await shiftsOf(w, out.created[0].id)
    expect(rows).toHaveLength(5) // nothing dropped, nothing invented
    expect(rows.filter((r) => r.user_id === null)).toHaveLength(2) // the source's open shift and the leave one
    const byReason = Object.fromEntries((out.conflicts as Json[]).map((c) => [c.reason, c.open]))
    expect(byReason).toEqual({ approved_leave: true, unavailable: false, public_holiday: false })
    expect(out.conflicts).toHaveLength(3)
    // the warned shift keeps its person
    expect(rows.find((r) => r.date === "2026-12-16")!.user_id).toBe(w.staff3.userId)
  })

  test("a person who left, whose licence ran out or who lacks the required qualification is an open shift with a conflict, whatever the rule severities (eligibility is not a setting)", async () => {
    const w = await sites()
    await w.rules(w.p.owner, { severity: { left: "ignore", expired_licence: "ignore" } })
    const armed = await w.type(w.a, "Armed", { requires: ["firearms"] })
    const wk = await w.week(w.p.owner, w.a, SRC)
    for (const who of [w.staff2, w.p.employee]) await w.ok("PUT", `/v1/members/${who.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "firearms", expiresOn: "2027-01-01" }] })
    await w.addOk(w.p.owner, wk, [
      { date: SRC, userIds: [w.staff2.userId], shiftTypeId: armed },
      { date: "2026-12-08", userIds: [w.p.employee.userId], shiftTypeId: armed },
      { date: "2026-12-09", userIds: [w.staff3.userId], shiftTypeId: w.ta },
    ])
    await publish(w, wk)
    await w.ok("PUT", `/v1/members/${w.staff2.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "firearms", expiresOn: "2026-12-10" }] }) // runs out before the copied date
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/qualifications`, w.p.owner, { qualifications: [] }) // no longer holds it
    await w.rows("update memberships set status = 'deactivated', deactivated_at = '2026-12-12T00:00:00Z' where tenant_id = $1 and user_id = $2", [w.tenant.id, w.staff3.userId])
    const out = await repeatOk(w, w.p.owner, wk, {})
    expect((await shiftsOf(w, out.created[0].id)).map((r) => r.user_id)).toEqual([null, null, null])
    expect((out.conflicts as Json[]).map((c) => [c.personId, c.reason, c.open]).sort()).toEqual([[w.staff2.userId, "expired_licence", true], [w.p.employee.userId, "qualification_missing", true], [w.staff3.userId, "left", true]].sort())
    expect(out.counts).toEqual({ copied: 3, kept: 0, warned: 0, opened: 3 })
  })

  test("a person the caller cannot know (a cross-site loan) is opened with ONE generic line: no leave dates, qualification or site", async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/members/${w.staff2.userId}/home-location`, w.p.owner, { locationId: w.b })
    const wk = await w.week(w.p.owner, w.a, SRC)
    await w.addOk(w.p.owner, wk, [{ date: "2026-12-08", userIds: [w.staff2.userId], shiftTypeId: w.ta }])
    await publish(w, wk)
    await leaveFor(w, w.staff2, "2026-12-15", "2026-12-15")
    const r = await repeat(w, w.p["location-supervisor"], wk, { version: await version(w, wk), weeks: 1 })
    const text = await r.text()
    expect(r.status, text).toBe(201)
    const out = JSON.parse(text) as Json
    expect(out.conflicts).toMatchObject([{ personId: w.staff2.userId, reason: "elsewhere", open: true, message: "Already rostered elsewhere" }])
    for (const secret of ["annual", "2026-12-15 to", "approved leave", w.b]) expect(text).not.toContain(secret)
  })

  test("a repeat that fails midway leaves nothing (all or nothing, N weeks)", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    // a trigger makes the SECOND new week fail after the first one and its shifts were written
    await ownerQuery(`create function fail_week_t2() returns trigger language plpgsql as $$ begin if new.week_start = '${T2}' then raise exception 'boom'; end if; return new; end $$`)
    await ownerQuery(`create trigger fail_week_t2 before insert on roster_weeks for each row execute function fail_week_t2()`)
    try {
      const r = await repeat(w, w.p.owner, wk, { version: await version(w, wk), weeks: 3 })
      expect(r.status).toBe(500)
    } finally {
      await ownerQuery(`drop trigger fail_week_t2 on roster_weeks`)
      await ownerQuery(`drop function fail_week_t2()`)
    }
    expect(await weekIdAt(w, w.a, T1)).toBeUndefined()
    expect(await weekIdAt(w, w.a, T2)).toBeUndefined()
    expect(await w.rows("select 1 from roster_shifts where week_id <> $1 and location_id = $2", [wk, w.a])).toHaveLength(0)
    expect(await w.rows("select 1 from roster_history where action = 'week_repeated'")).toHaveLength(0)
    expect(await w.rows("select 1 from audit_events where action = 'roster.week_repeated'")).toHaveLength(0)
  })

  test("N weeks: each target is its own draft copied from the source; a published or drafted target anywhere in the range refuses the whole request", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const out = await repeatOk(w, w.p.owner, wk, { weeks: 3 })
    expect(out.created.map((c: Json) => c.weekStart)).toEqual([T1, T2, T3])
    expect(out.counts.copied).toBe(9)
    for (const c of out.created) expect(await shiftsOf(w, c.id)).toHaveLength(3)
    // the last target now exists as a draft; a bigger repeat is refused whole and writes nothing new
    const before = (await w.rows("select count(*)::int n from roster_shifts"))[0].n
    const nope = await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: await version(w, wk), weeks: 4 }, 409)
    expect(nope.code).toBe("week_exists_draft")
    expect((await w.rows("select count(*)::int n from roster_shifts"))[0].n).toBe(before)
    expect(await weekIdAt(w, w.a, "2027-01-04")).toBeUndefined()
  })

  test("replace with targetVersions: a target draft edited after the caller looked (stale version) is 409 version_conflict and nothing is written; the current versions pass", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const t1 = await w.week(w.p.owner, w.a, T1)
    await w.addOk(w.p.owner, t1, [{ date: T1, userIds: [w.p.owner.userId], shiftTypeId: w.ta }])
    const seen = await version(w, t1)
    await w.addOk(w.p.owner, t1, [{ date: T1, userIds: [w.staff3.userId], shiftTypeId: w.ta }]) // someone edits the target after the caller looked
    const v = await version(w, wk)
    expect(seen).not.toBe(await version(w, t1))
    const before = await shiftsOf(w, t1)
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: v, weeks: 1, replace: true, targetVersions: { [T1]: seen } }, 409)).code).toBe("version_conflict")
    expect(await shiftsOf(w, t1)).toHaveLength(before.length) // untouched
    expect((await shiftsOf(w, t1)).some((r) => r.user_id === w.staff3.userId)).toBe(true)
    await repeatOk(w, w.p.owner, wk, { replace: true, targetVersions: { [T1]: await version(w, t1) } })
    expect((await shiftsOf(w, t1)).some((r) => r.user_id === w.staff3.userId)).toBe(false)
  })

  test("AG1: replace:true REQUIRES targetVersions for every existing target draft (422 targets_version_required, nothing written); a key outside the target set is 422 invalid_target_version; a stale one 409; a key for a week that does not exist 409", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const t1 = await w.week(w.p.owner, w.a, T1)
    const t2 = await w.week(w.p.owner, w.a, T2)
    await w.addOk(w.p.owner, t1, [{ date: T1, userIds: [w.staff3.userId], shiftTypeId: w.ta }])
    const v = await version(w, wk)
    const before = (await w.rows("select count(*)::int n from roster_shifts"))[0].n
    const nothingWritten = async () => expect((await w.rows("select count(*)::int n from roster_shifts"))[0].n).toBe(before)
    // none at all, then one of two missing
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: v, weeks: 2, replace: true }, 422)).code).toBe("targets_version_required")
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: v, weeks: 2, replace: true, targetVersions: { [T1]: await version(w, t1) } }, 422)).code).toBe("targets_version_required")
    // a key that is not one of the target Mondays (the source itself, a week beyond N, a non-Monday)
    for (const key of [SRC, T3, "2026-12-16"]) {
      expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: v, weeks: 2, replace: true, targetVersions: { [T1]: await version(w, t1), [T2]: await version(w, t2), [key]: 1 } }, 422)).code, key).toBe("invalid_target_version")
    }
    await nothingWritten()
    // stale -> 409, a key for a target that does not exist -> 409
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: v, weeks: 2, replace: true, targetVersions: { [T1]: 99, [T2]: await version(w, t2) } }, 409)).code).toBe("version_conflict")
    await nothingWritten()
    // all current: passes; the new week T3 needs no version (it does not exist yet)
    await repeatOk(w, w.p.owner, wk, { weeks: 3, replace: true, targetVersions: { [T1]: await version(w, t1), [T2]: await version(w, t2) } })
  })

  test("a location in another zone than the tenant keeps its wall times across ITS clock change: Sydney 09:00 on Mon 29 Mar 2027 (AEDT) repeats to 09:00 on Mon 5 Apr (AEST, the clocks went back on the 4th), not 09:00 Dublin", async () => {
    const w = await sites()
    await w.rows("update locations set time_zone = 'Australia/Sydney' where id = $1", [w.a])
    const src = await w.week(w.p.owner, w.a, "2027-03-29")
    await w.addOk(w.p.owner, src, [{ date: "2027-03-29", userIds: [w.p.employee.userId], shiftTypeId: w.ta, start: "09:00", end: "17:00" }])
    await publish(w, src)
    const out = await repeatOk(w, w.p.owner, src, {})
    const [from] = await shiftsOf(w, src)
    const [copy] = await shiftsOf(w, out.created[0].id)
    expect([from.date, from.start_time, new Date(from.start_at).toISOString()]).toEqual(["2027-03-29", "09:00", "2027-03-28T22:00:00.000Z"]) // 09:00 AEDT (UTC+11)
    expect([copy.date, copy.start_time, copy.end_time]).toEqual(["2027-04-05", "09:00", "17:00"]) // the wall time is kept
    expect(new Date(copy.start_at).toISOString()).toBe("2027-04-04T23:00:00.000Z") // 09:00 AEST (UTC+10): an hour later than the same wall time before the change
    expect(new Date(copy.end_at).toISOString()).toBe("2027-04-05T07:00:00.000Z")
  })

  test("a published target is 409 week_published; a draft target needs replace: true (without it 409 week_exists_draft, with it the old shifts are replaced, never duplicated); weeks outside 1..12 is 422; a stale version is 409", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const t1 = await w.week(w.p.owner, w.a, T1)
    await w.addOk(w.p.owner, t1, [{ date: T1, userIds: [w.staff3.userId], shiftTypeId: w.ta }]) // an old draft shift
    const v = await version(w, wk)
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: v, weeks: 1 }, 409)).code).toBe("week_exists_draft")
    expect(await shiftsOf(w, t1)).toHaveLength(1) // untouched
    const out = await repeatOk(w, w.p.owner, wk, { replace: true, targetVersions: await tv(w, wk, 1) })
    expect(out.created[0].id).toBe(t1) // the same week row, new content
    const rows = await shiftsOf(w, t1)
    expect(rows).toHaveLength(3)
    expect(rows.some((r) => r.user_id === w.staff3.userId)).toBe(false)
    const removed = await w.rows("select before from roster_history where action = 'shift_removed' and week_id = $1", [t1])
    expect(removed).toHaveLength(1) // the replaced shift is in history whole
    expect(removed[0].before).toMatchObject({ userId: w.staff3.userId, date: T1 })
    // retry of the same replace: no duplicates
    await repeatOk(w, w.p.owner, wk, { replace: true, targetVersions: await tv(w, wk, 1) })
    expect(await shiftsOf(w, t1)).toHaveLength(3)
    // a published target
    await publish(w, t1)
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: await version(w, wk), weeks: 1, replace: true }, 409)).code).toBe("week_published")
    for (const weeks of [0, 13, 1.5, -1]) expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: await version(w, wk), weeks }, 422)).code).toBe("invalid_weeks")
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: 99, weeks: 2 }, 409)).code).toBe("version_conflict")
  })

  test("repeat across the clock change keeps wall start and end of each shift; the 22:00-06:00 shift on 24 to 25 Oct 2026 repeats to the week after with correct instants; a start in the 28 Mar 2027 gap resolves to 02:00 IST", async () => {
    const w = await sites()
    const night = await w.type(w.a, "Night", { start: "22:00", end: "06:00" })
    const wk = await w.week(w.p.owner, w.a, "2026-10-19")
    await w.addOk(w.p.owner, wk, [{ date: "2026-10-24", userIds: [w.p.employee.userId], shiftTypeId: night }, { date: "2026-10-19", userIds: [w.staff2.userId], shiftTypeId: w.ta }])
    await publish(w, wk)
    const [monSrc, src] = await shiftsOf(w, wk) // by date: the Monday day shift, then the Saturday night
    expect(monSrc.start_at.toISOString()).toBe("2026-10-19T07:00:00.000Z") // 08:00 IST
    expect([src.start_at.toISOString(), src.end_at.toISOString()]).toEqual(["2026-10-24T21:00:00.000Z", "2026-10-25T06:00:00.000Z"]) // 9 real hours
    const out = await repeatOk(w, w.p.owner, wk, { weeks: 1 })
    const first = await shiftsOf(w, out.created[0].id)
    const sat = first.find((r) => r.start_time === "22:00")!
    expect(sat.date).toBe("2026-10-31")
    expect([sat.start_at.toISOString(), sat.end_at.toISOString()]).toEqual(["2026-10-31T22:00:00.000Z", "2026-11-01T06:00:00.000Z"]) // GMT now: 8 hours, the WALL times are kept
    const mon = first.find((r) => r.start_time === "08:00")!
    expect([mon.date, mon.start_at.toISOString()]).toEqual(["2026-10-26", "2026-10-26T08:00:00.000Z"]) // 08:00 IST (07:00Z) the week before, 08:00 GMT now
    // spring: a 01:30 start on Sunday 21 Mar 2027 repeats onto the gap of 28 Mar
    const gap = await w.type(w.a, "Early", { start: "01:30", end: "09:30" })
    const sw = await w.week(w.p.owner, w.a, "2027-03-15")
    await w.addOk(w.p.owner, sw, [{ date: "2027-03-21", userIds: [w.p.employee.userId], shiftTypeId: gap }])
    await publish(w, sw)
    const g = await repeatOk(w, w.p.owner, sw, {})
    const [spring] = await shiftsOf(w, g.created[0].id)
    expect(spring).toMatchObject({ date: "2027-03-28", start_time: "01:30", end_time: "09:30" })
    expect([spring.start_at.toISOString(), spring.end_at.toISOString()]).toEqual(["2027-03-28T01:00:00.000Z", "2027-03-28T08:30:00.000Z"]) // 02:00 IST to 09:30 IST
  })

  test("repeat is allowed for a supervisor on their own location's published source (the copy is a draft), refused for a location they cannot see (404, identical for a missing or non-uuid id); the published TARGET stays locked for a supervisor", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const sup = w.p["location-supervisor"]
    const out = await repeatOk(w, sup, wk, { weeks: 2 })
    expect(out.created.map((c: Json) => c.status)).toEqual(["draft", "draft"])
    const strip = async (r: Response) => ({ status: r.status, ct: r.headers.get("content-type"), code: ((await r.json()) as Json).code, headers: [...r.headers.entries()].filter(([k]) => !["x-request-id", "date", "content-length"].includes(k)).sort() })
    const bravo = await w.week(w.p.owner, w.b, SRC)
    const seen = []
    for (const id of [bravo, "00000000-0000-4000-8000-000000000000", "nope", "1' or '1'='1"]) seen.push(await strip(await repeat(w, sup, encodeURIComponent(id), { version: 1, weeks: 1 })))
    expect(seen[0]).toMatchObject({ status: 404 })
    for (const s of seen) expect(s).toEqual(seen[0])
    expect(await weekIdAt(w, w.b, T1)).toBeUndefined()
    // a published target
    await publish(w, out.created[0].id, sup)
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, sup, { version: await version(w, wk), weeks: 1, replace: true }, 409)).code).toBe("week_published")
    for (const who of [w.p.employee, w.p.manager]) expect((await repeat(w, who, wk, { version: await version(w, wk), weeks: 1 })).status).toBe(403)
  })

  test("an archived location refuses a repeat (409 location_archived); a double click is one set of drafts (the second is 409 week_exists_draft)", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const v = await version(w, wk)
    const both = await Promise.all([repeat(w, w.p.owner, wk, { version: v, weeks: 1 }), repeat(w, w.p.owner, wk, { version: v, weeks: 1 })])
    expect(both.map((r) => r.status).sort()).toEqual([201, 409])
    expect(((await both.find((r) => r.status === 409)!.json()) as Json).code).toBe("week_exists_draft")
    expect(await shiftsOf(w, (await weekIdAt(w, w.a, T1))!)).toHaveLength(3)
    await w.ok("POST", `/v1/locations/${w.a}/archive`, w.p.owner)
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: v, weeks: 1, replace: true }, 409)).code).toBe("location_archived")
  })

  test("public holiday in the target week is an information line only and the person stays", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    await w.rows("insert into public_holidays (tenant_id, date, name) values ($1, '2026-12-15', 'Local holiday')", [w.tenant.id])
    const out = await repeatOk(w, w.p.owner, wk, {})
    expect(out.conflicts).toMatchObject([{ reason: "public_holiday", open: false, personId: w.staff2.userId, date: "2026-12-15" }])
    expect((await shiftsOf(w, out.created[0].id)).find((r) => r.date === "2026-12-15")!.user_id).toBe(w.staff2.userId)
    expect(out.counts).toEqual({ copied: 3, kept: 2, warned: 1, opened: 0 })
  })

  test("an empty week repeats to empty drafts (nothing invented, counts zero)", async () => {
    const w = await sites()
    const wk = await w.week(w.p.owner, w.a, SRC)
    await publish(w, wk)
    const out = await repeatOk(w, w.p.owner, wk, { weeks: 2 })
    expect(out.created.map((c: Json) => c.weekStart)).toEqual([T1, T2])
    expect(out.counts).toEqual({ copied: 0, kept: 0, warned: 0, opened: 0 })
    expect(out.conflicts).toEqual([])
    expect(await w.rows("select 1 from roster_shifts where week_id = any($1)", [out.created.map((c: Json) => c.id)])).toHaveLength(0)
  })

  test("the rule check runs against the whole roster under the lock: a person already rostered at ANOTHER site in the target week makes the copy an open shift", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const other = await w.week(w.p.owner, w.b, T1)
    await w.addOk(w.p.owner, other, [{ date: "2026-12-15", userIds: [w.staff2.userId], shiftTypeId: w.tb }]) // Cian at Bravo, the same hours as the Alpha copy
    const out = await repeatOk(w, w.p.owner, wk, {})
    expect(out.conflicts).toMatchObject([{ personId: w.staff2.userId, reason: "double_booking", open: true }])
  })
})

describe("cost of a repeat under the roster lock", () => {
  test("a 200-shift week of 40 people with 17 weeks of history repeats over 4 weeks well inside the lock budget (wall times are remembered, not recomputed per comparison); the rows are right", async () => {
    const w = await sites()
    await w.rows(`insert into "user" (id, name, email, email_verified, created_at, updated_at) select 'bulk_' || g, 'B' || g, 'b' || g || '@x.com', true, now(), now() from generate_series(0, 39) g`)
    await w.rows(`insert into memberships (tenant_id, user_id, role_id, status, joined_at) select $1, 'bulk_' || g, (select id from roles where tenant_id = $1 and key = 'employee'), 'active', now() from generate_series(0, 39) g`, [w.tenant.id])
    const starts = Array.from({ length: 18 }, (_, k) => new Date(Date.UTC(2026, 11, 7) - (17 - k) * 7 * 864e5).toISOString().slice(0, 10)) // the last one is the source (SRC)
    const ids: Record<string, string> = {}
    for (const ws of starts) ids[ws] = await w.week(w.p.owner, w.a, ws)
    for (const ws of starts) {
      await w.rows(
        `insert into roster_shifts (tenant_id, week_id, location_id, date, user_id, shift_type_id, role, start_time, end_time, start_at, end_at, created_at, updated_at)
         select $1, $2, $3, ($4::date + (g % 5)), 'bulk_' || (g / 5), $5, 'Guard', '08:00', '16:00', (($4::date + (g % 5))::timestamp + interval '8 hours')::timestamptz, (($4::date + (g % 5))::timestamp + interval '16 hours')::timestamptz, now(), now()
           from generate_series(0, 199) g`,
        [w.tenant.id, ids[ws], w.a, ws, w.ta],
      )
    }
    await w.rows("update roster_weeks set status = 'published' where id = $1", [ids[SRC]])
    const t0 = Date.now()
    const out = await repeatOk(w, w.p.owner, ids[SRC], { weeks: 4 })
    expect(Date.now() - t0).toBeLessThan(20_000) // it was 82 s before the wall-time memo: far past the 5 s lock timeout every other roster writer waits behind
    expect(out.counts).toEqual({ copied: 800, kept: 800, warned: 0, opened: 0 })
    expect((await w.rows("select count(*)::int n from roster_shifts where source_shift_id is not null"))[0].n).toBe(800)
  }, 120_000)
})

describe("week templates (FR-RS-27, 28, 29)", () => {
  const save = (w: W, who: Who, weekId: string, name: string) => w.req("POST", `/v1/roster/weeks/${weekId}/save-template`, who, { name })

  test("save, list and delete: a supervisor saves and lists their own location's template; deleting needs an office role (supervisor 403); the list carries no people", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const sup = w.p["location-supervisor"]
    const r = await save(w, sup, wk, "  Coppers standard week ")
    const tpl = (await r.json()) as Json
    expect(r.status).toBe(201)
    expect(tpl).toMatchObject({ locationId: w.a, name: "Coppers standard week", shifts: 3 })
    expect(JSON.stringify(tpl)).not.toContain(w.p.employee.userId)
    const [stored] = await w.rows("select shifts, created_by from roster_week_templates where id = $1", [tpl.id])
    expect(stored.created_by).toBe(sup.userId)
    expect(stored.shifts.map((s: Json) => [s.day, s.start, s.end, s.typeName])).toEqual([[0, "08:00", "16:00", "Day"], [1, "08:00", "16:00", "Day"], [2, "09:00", "15:00", "Day"]])
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/save-template`, sup, { name: "Coppers standard week" }, 409)).code).toBe("template_name_taken")
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/save-template`, sup, { name: "   " }, 422)).code).toBe("invalid_template")
    const list = await w.ok("GET", `/v1/roster/week-templates?locationId=${w.a}`, sup)
    expect(list.items).toEqual([expect.objectContaining({ id: tpl.id, name: "Coppers standard week", shifts: 3, locationId: w.a })])
    expect(JSON.stringify(list)).not.toContain(w.p.employee.userId)
    // a supervisor sees only granted locations; a hidden location filter is the one 404
    const bravo = await w.week(w.p.owner, w.b, SRC)
    await save(w, w.p.owner, bravo, "Bravo week")
    expect((await w.ok("GET", "/v1/roster/week-templates", sup)).items.map((i: Json) => i.locationId)).toEqual([w.a])
    expect((await w.req("GET", `/v1/roster/week-templates?locationId=${w.b}`, sup)).status).toBe(404)
    expect((await w.ok("GET", "/v1/roster/week-templates", w.p.owner)).items).toHaveLength(2)
    expect((await w.req("GET", "/v1/roster/week-templates", w.p.employee)).status).toBe(200) // staff: an empty cut
    expect((await w.ok("GET", "/v1/roster/week-templates", w.p.employee)).items).toEqual([])
    // delete: office only
    expect((await w.fail("DELETE", `/v1/roster/week-templates/${tpl.id}`, sup, undefined, 403)).code).toBe("forbidden")
    expect((await w.req("DELETE", `/v1/roster/week-templates/${tpl.id}`, w.p.owner)).status).toBe(204)
    expect(await w.rows("select 1 from roster_week_templates where id = $1", [tpl.id])).toHaveLength(0)
    expect(await w.rows("select 1 from audit_events where action = 'roster.template_deleted' and entity_id = $1", [tpl.id])).toHaveLength(1)
    expect((await w.fail("DELETE", `/v1/roster/week-templates/${tpl.id}`, w.p.owner, undefined, 404)).code).toBe("not_found")
  })

  test("a template of a location the caller cannot see is the same 404 as a missing or non-uuid one; a draft week can be saved too; a read-only manager and staff are 403", async () => {
    const w = await sites()
    const bravo = await w.week(w.p.owner, w.b, SRC)
    await w.addOk(w.p.owner, bravo, [{ date: SRC, userIds: [null], shiftTypeId: w.tb }])
    const tpl = (await (await save(w, w.p.owner, bravo, "Bravo week")).json()) as Json
    const sup = w.p["location-supervisor"]
    const gone: unknown[] = []
    for (const id of [tpl.id, "00000000-0000-4000-8000-000000000000", "nope"]) {
      const r = await w.req("DELETE", `/v1/roster/week-templates/${id}`, sup)
      gone.push([r.status, ((await r.json()) as Json).code, [...r.headers.entries()].filter(([k]) => !["x-request-id", "date", "content-length"].includes(k)).sort()])
    }
    expect(gone[0]).toEqual(gone[1]) // a hidden template answers exactly like a missing one and a non-uuid id
    expect(gone[1]).toEqual(gone[2])
    expect((gone[0] as unknown[])[0]).toBe(404)
    const hidden = await w.req("POST", "/v1/roster/week-templates/apply", sup, { templateId: tpl.id, locationId: w.a, weekStart: T1 })
    const missing = await w.req("POST", "/v1/roster/week-templates/apply", sup, { templateId: "00000000-0000-4000-8000-000000000000", locationId: w.a, weekStart: T1 })
    expect([hidden.status, ((await hidden.json()) as Json).code]).toEqual([missing.status, ((await missing.json()) as Json).code])
    expect(hidden.status).toBe(404)
    for (const who of [w.p.manager, w.p.employee]) expect((await save(w, who, bravo, "x")).status).toBe(403)
    expect((await save(w, sup, bravo, "x")).status).toBe(404) // a week of a location the supervisor does not see
  })

  test("apply: a template starts a new draft week; people and individual times come back; the target must have no roster (an existing week with shifts is 409 week_exists, a published one 409 week_published, an EMPTY draft is filled)", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const tpl = (await (await save(w, w.p.owner, wk, "Std")).json()) as Json
    const ok = await w.ok("POST", "/v1/roster/week-templates/apply", w.p["location-supervisor"], { templateId: tpl.id, locationId: w.a, weekStart: T1 }, 201)
    expect(ok.week).toMatchObject({ locationId: w.a, weekStart: T1, status: "draft" })
    expect(ok.counts).toEqual({ copied: 3, kept: 3, warned: 0, opened: 0 })
    const rows = await shiftsOf(w, ok.week.id)
    expect(rows.map((r) => [r.date, r.user_id, r.start_time, r.end_time])).toEqual([[T1, w.p.employee.userId, "08:00", "16:00"], ["2026-12-15", w.staff2.userId, "08:00", "16:00"], ["2026-12-16", w.p.employee.userId, "09:00", "15:00"]])
    const again = await w.fail("POST", "/v1/roster/week-templates/apply", w.p["location-supervisor"], { templateId: tpl.id, locationId: w.a, weekStart: T1 }, 409)
    expect(again).toMatchObject({ code: "week_exists", weekId: ok.week.id })
    await publish(w, ok.week.id)
    expect((await w.fail("POST", "/v1/roster/week-templates/apply", w.p["location-supervisor"], { templateId: tpl.id, locationId: w.a, weekStart: T1 }, 409)).code).toBe("week_published")
    const empty = await w.week(w.p.owner, w.a, T2)
    const filled = await w.ok("POST", "/v1/roster/week-templates/apply", w.p.owner, { templateId: tpl.id, locationId: w.a, weekStart: T2 }, 201)
    expect(filled.week.id).toBe(empty)
    expect(await shiftsOf(w, empty)).toHaveLength(3)
    expect((await w.fail("POST", "/v1/roster/week-templates/apply", w.p.owner, { templateId: tpl.id, locationId: w.a, weekStart: "2026-12-30" }, 422)).code).toBe("invalid_week_start")
    expect((await w.fail("POST", "/v1/roster/week-templates/apply", w.p.owner, { templateId: tpl.id, locationId: w.a, weekStart: "2026-02-30" }, 422)).code).toBe("invalid_week_start")
    expect(await w.rows("select 1 from roster_history where action = 'week_template_applied'")).toHaveLength(2)
    expect(await w.rows("select 1 from audit_events where action = 'roster.template_applied'")).toHaveLength(2)
  })

  test("applying a template at another location turns people from elsewhere into open shifts and matches that site's shift type by name (else shift type null is 422 no_matching_type)", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    await w.ok("PUT", `/v1/members/${w.staff2.userId}/home-location`, w.p.owner, { locationId: w.b }) // Cian is Bravo's person; the employee is homed nowhere
    const tpl = (await (await save(w, w.p.owner, wk, "Std")).json()) as Json
    // Bravo has "Day" too (case-insensitive name match): the people from elsewhere are open, the Bravo person stays
    const out = await w.ok("POST", "/v1/roster/week-templates/apply", w.p.owner, { templateId: tpl.id, locationId: w.b, weekStart: T1 }, 201)
    const rows = await w.rows("select user_id, shift_type_id, role, date from roster_shifts where week_id = $1 order by date", [out.week.id])
    expect(rows.map((r) => r.user_id)).toEqual([null, w.staff2.userId, null])
    expect(rows.every((r) => r.shift_type_id === w.tb)).toBe(true)
    expect((out.conflicts as Json[]).map((c) => [c.reason, c.open])).toEqual([["not_in_location", true], ["not_in_location", true]])
    expect(out.counts).toEqual({ copied: 3, kept: 1, warned: 0, opened: 2 })
    // a type with no namesake at the target is 422 and nothing is written
    const night = await w.type(w.a, "Night only here", { start: "22:00", end: "06:00" })
    const wk2 = await w.week(w.p.owner, w.a, T2)
    await w.addOk(w.p.owner, wk2, [{ date: T2, userIds: [null], shiftTypeId: night }])
    const tpl2 = (await (await save(w, w.p.owner, wk2, "Nights")).json()) as Json
    const bad = await w.fail("POST", "/v1/roster/week-templates/apply", w.p.owner, { templateId: tpl2.id, locationId: w.b, weekStart: T3 }, 422)
    expect(bad).toMatchObject({ code: "no_matching_type", typeNames: ["Night only here"] })
    expect(await weekIdAt(w, w.b, T3)).toBeUndefined()
    // the same template at its own location needs no match
    await w.ok("POST", "/v1/roster/week-templates/apply", w.p.owner, { templateId: tpl2.id, locationId: w.a, weekStart: T3 }, 201)
  })

  test("a location holds at most 50 templates (409 template_limit); an archived location refuses an apply (409 location_archived); a template of open shifts only applies and checks nobody", async () => {
    const w = await sites()
    const wk = await w.week(w.p.owner, w.a, SRC)
    await w.addOk(w.p.owner, wk, [{ date: SRC, userIds: [null, null], shiftTypeId: w.ta }])
    const tpl = (await (await save(w, w.p.owner, wk, "Open only")).json()) as Json
    const applied = await w.ok("POST", "/v1/roster/week-templates/apply", w.p.owner, { templateId: tpl.id, locationId: w.a, weekStart: T1 }, 201)
    expect(applied).toMatchObject({ conflicts: [], counts: { copied: 2, kept: 2, warned: 0, opened: 0 } })
    expect((await shiftsOf(w, applied.week.id)).map((r) => r.user_id)).toEqual([null, null])
    await w.rows("insert into roster_week_templates (tenant_id, location_id, name, shifts, created_at, updated_at) select $1, $2, 'T' || g, '[]'::jsonb, now(), now() from generate_series(1, 49) g", [w.tenant.id, w.a])
    expect((await w.fail("POST", `/v1/roster/weeks/${wk}/save-template`, w.p.owner, { name: "One too many" }, 409)).code).toBe("template_limit")
    await w.ok("POST", `/v1/locations/${w.a}/archive`, w.p.owner)
    expect((await w.fail("POST", "/v1/roster/week-templates/apply", w.p.owner, { templateId: tpl.id, locationId: w.a, weekStart: T2 }, 409)).code).toBe("location_archived")
    expect(await weekIdAt(w, w.a, T2)).toBeUndefined()
  })

  test("a template cannot be applied to a location the caller cannot see (404), and a supervisor cannot reach another site's template", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const tpl = (await (await save(w, w.p.owner, wk, "Std")).json()) as Json
    const r = await w.req("POST", "/v1/roster/week-templates/apply", w.p["location-supervisor"], { templateId: tpl.id, locationId: w.b, weekStart: T1 })
    expect(r.status).toBe(404)
    expect(await weekIdAt(w, w.b, T1)).toBeUndefined()
  })
})

describe("auto-repeat setting (FR-RS-28)", () => {
  test("PUT sets and clears the days on the week (history and audit, the week version is not an edit), supervisor on their own location, 422 outside 1..365, manager 403, hidden 404", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    const sup = w.p["location-supervisor"]
    const v = await version(w, wk)
    const set = await w.ok("PUT", `/v1/roster/weeks/${wk}/auto-repeat`, sup, { days: 7 })
    expect(set).toMatchObject({ id: wk, autoRepeatDays: 7, status: "published", version: v })
    expect(await w.rows("select action, before, after from roster_history where action = 'auto_repeat_changed'")).toEqual([expect.objectContaining({ before: { autoRepeatDays: null }, after: { autoRepeatDays: 7 } })])
    expect(await w.rows("select 1 from audit_events where action = 'roster.auto_repeat_changed' and entity_id = $1", [wk])).toHaveLength(1)
    await w.ok("PUT", `/v1/roster/weeks/${wk}/auto-repeat`, sup, { days: 7 }) // unchanged: writes nothing
    expect(await w.rows("select 1 from roster_history where action = 'auto_repeat_changed'")).toHaveLength(1)
    expect((await w.ok("PUT", `/v1/roster/weeks/${wk}/auto-repeat`, sup, { days: null })).autoRepeatDays).toBeNull()
    for (const days of [0, 366, 1.5, -3]) expect((await w.fail("PUT", `/v1/roster/weeks/${wk}/auto-repeat`, sup, { days }, 422)).code).toBe("invalid_days")
    expect((await w.req("PUT", `/v1/roster/weeks/${wk}/auto-repeat`, w.p.manager, { days: 7 })).status).toBe(403)
    expect((await w.req("PUT", `/v1/roster/weeks/${wk}/auto-repeat`, w.p.employee, { days: 7 })).status).toBe(403)
    const bravo = await w.week(w.p.owner, w.b, SRC)
    expect((await w.req("PUT", `/v1/roster/weeks/${bravo}/auto-repeat`, sup, { days: 7 })).status).toBe(404)
    expect((await w.req("PUT", `/v1/roster/weeks/nope/auto-repeat`, sup, { days: 7 })).status).toBe(404)
  })

  test("a repeat copy inherits the source's auto-repeat days (the chain continues from the newest copy)", async () => {
    const w = await sites()
    const { wk } = await coppers(w)
    await w.ok("PUT", `/v1/roster/weeks/${wk}/auto-repeat`, w.p.owner, { days: 5 })
    const out = await repeatOk(w, w.p.owner, wk, { weeks: 2 })
    expect(out.created.map((c: Json) => c.autoRepeatDays)).toEqual([5, 5])
  })
})
