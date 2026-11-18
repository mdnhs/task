import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, test } from "vitest"
import { call, resetDb } from "../../../test/harness"
import { ownerTenantQuery } from "../../../test/db"
import { MON, sites, type Json } from "./testkit"

// B8 Task 9: draft shifts: add (several people), move, remove; individual times, overnight, DST instants, eligibility, the rule gate, versions.

beforeEach(resetDb)

const ms = (v: unknown) => new Date(v as string).getTime()
const strip = (r: Response, body: string) => ({ status: r.status, ct: r.headers.get("content-type"), code: (JSON.parse(body) as Json).code, headers: [...r.headers.entries()].filter(([k]) => !["x-request-id", "date", "content-length"].includes(k)).sort() })

describe("add shifts (FR-RS-20, 22)", () => {
  test("AC-RS-02: two people on one shift with different start times both persist and read back", async () => {
    const w = await sites()
    const r = await w.addOk(w.p["location-supervisor"], w.wa, [
      { date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta },
      { date: MON, userIds: [w.staff2.userId], shiftTypeId: w.ta, start: "09:30", end: "17:30", unpaidBreakMin: 15 },
    ])
    expect(r.shifts.map((s: Json) => [s.userId, s.start, s.end, s.unpaidBreakMin])).toEqual([[w.p.employee.userId, "08:00", "16:00", 0], [w.staff2.userId, "09:30", "17:30", 15]])
    const read = await w.ok("GET", `/v1/roster/weeks/${w.wa}`, w.p["location-supervisor"])
    const by = (u: string) => read.shifts.find((s: Json) => s.userId === u)
    expect(by(w.p.employee.userId)).toMatchObject({ start: "08:00", end: "16:00", startAt: "2026-11-02T08:00:00.000Z", endAt: "2026-11-02T16:00:00.000Z" })
    expect(by(w.staff2.userId)).toMatchObject({ start: "09:30", end: "17:30", startAt: "2026-11-02T09:30:00.000Z", endAt: "2026-11-02T17:30:00.000Z" })
    const [h] = await w.rows("select count(*)::int as n from roster_history where action = 'shift_added' and week_id = $1", [w.wa])
    expect(h.n).toBe(2)
    expect((await w.rows("select version from roster_weeks where id = $1", [w.wa]))[0].version).toBe(2) // the week version moves with its shifts
  })

  test("FR-RS-21: a 22:00-06:00 shift stays on its start date and ends the next day; Review Focus 3: the clock-change night is 540 real minutes", async () => {
    const w = await sites()
    const night = await w.type(w.a, "Night", { start: "22:00", end: "06:00" })
    const wk = await w.week(w.p.owner, w.a, "2026-10-19")
    const r = await w.addOk(w.p.owner, wk, [
      { date: "2026-10-24", userIds: [w.p.employee.userId], shiftTypeId: night }, // the night the clocks go back
      { date: "2026-10-21", userIds: [w.staff2.userId], shiftTypeId: night },
    ])
    const [change, plain] = [r.shifts[0], r.shifts[1]]
    expect(change.date).toBe("2026-10-24")
    expect((ms(change.endAt) - ms(change.startAt)) / 60_000).toBe(540)
    expect(change.startAt).toBe("2026-10-24T21:00:00.000Z") // 22:00 IST
    expect(change.endAt).toBe("2026-10-25T06:00:00.000Z") // 06:00 GMT
    expect((ms(plain.endAt) - ms(plain.startAt)) / 60_000).toBe(480)
    expect((await w.ok("GET", `/v1/roster/weeks/${wk}`, w.p.owner)).weeks[0].days.find((d: Json) => d.date === "2026-10-24").count).toBe(1) // counted on the start day
    // equal start and end is refused, so is a break as long as the shift
    for (const bad of [{ start: "08:00", end: "08:00" }, { unpaidBreakMin: 480 }, { start: "8:00" }, { end: "24:00" }]) {
      expect((await w.fail("POST", `/v1/roster/weeks/${wk}/shifts`, w.p.owner, { shifts: [{ date: "2026-10-20", userIds: [null], shiftTypeId: night, ...bad }] }, 422)).code, JSON.stringify(bad)).toBe("invalid_shift")
    }
  })

  test("a start in the 29 Mar 2026 gap is stored as 02:00 local (R8-1), a start in the 25 Oct 2026 fold takes the first occurrence", async () => {
    const w = await sites()
    const wk = await w.week(w.p.owner, w.a, "2026-03-23")
    const gap = (await w.addOk(w.p.owner, wk, [{ date: "2026-03-29", userIds: [w.p.employee.userId], shiftTypeId: w.ta, start: "01:30", end: "09:00" }])).shifts[0]
    expect(gap.startAt).toBe("2026-03-29T01:00:00.000Z") // 02:00 IST, the first valid minute after the gap
    expect(gap.start).toBe("01:30") // the wall string stays the source for display
    expect(ms(gap.endAt) - ms(gap.startAt)).toBe(7 * 3_600_000) // 02:00 IST to 09:00 IST
    const fold = await w.week(w.p.owner, w.a, "2026-10-19")
    const f = (await w.addOk(w.p.owner, fold, [{ date: "2026-10-25", userIds: [w.p.employee.userId], shiftTypeId: w.ta, start: "01:30", end: "08:00" }])).shifts[0]
    expect(f.startAt).toBe("2026-10-25T00:30:00.000Z") // the first 01:30 (IST), not the second (GMT)
  })

  test("a location with its own zone reads wall times in that zone (R8-2)", async () => {
    const w = await sites()
    await w.ok("PATCH", `/v1/locations/${w.a}`, w.p.owner, { version: 1, timeZone: "America/New_York" })
    const s = (await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [null], shiftTypeId: w.ta }])).shifts[0]
    expect(s.startAt).toBe("2026-11-02T13:00:00.000Z") // 08:00 EST
  })

  test("assign several people in one request is atomic: if the third is ineligible none is written", async () => {
    const w = await sites()
    await w.ok("POST", `/v1/members/${w.staff3.userId}/deactivate`, w.p.owner)
    const r = await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, { shifts: [{ date: MON, userIds: [w.p.employee.userId, w.staff2.userId, w.staff3.userId], shiftTypeId: w.ta }] }, 422)
    expect(r.code).toBe("ineligible")
    expect(r.errors).toEqual([{ userId: w.staff3.userId, date: MON, reason: "left" }])
    expect(await w.rows("select 1 from roster_shifts")).toHaveLength(0)
    expect(await w.rows("select 1 from roster_history where action = 'shift_added'")).toHaveLength(0)
    expect((await w.rows("select version from roster_weeks where id = $1", [w.wa]))[0].version).toBe(1)
  })

  test("an open shift (null user) is allowed and does not count towards the day's staff count", async () => {
    const w = await sites()
    await w.ok("PUT", `/v1/shift-types/${w.ta}/targets`, w.p.owner, { targets: [{ weekday: 1, count: 2 }] })
    const r = await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [null, null, w.p.employee.userId], shiftTypeId: w.ta }]) // two open rows may repeat
    expect(r.shifts.filter((s: Json) => s.userId === null)).toHaveLength(2)
    expect((await w.ok("GET", `/v1/roster/weeks/${w.wa}`, w.p.owner)).weeks[0].days[0]).toMatchObject({ count: 1, target: 2, short: 1 })
  })

  test("a supervisor edits a draft week of a granted location; the same call on another location is 404", async () => {
    const w = await sites()
    const sup = w.p["location-supervisor"]
    expect((await w.add(sup, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).status).toBe(201)
    const [hidden, missing, notUuid] = await Promise.all([
      w.add(sup, w.wb, [{ date: MON, userIds: [null], shiftTypeId: w.tb }]),
      w.add(sup, "00000000-0000-4000-8000-000000000000", [{ date: MON, userIds: [null], shiftTypeId: w.tb }]),
      w.add(sup, "nope", [{ date: MON, userIds: [null], shiftTypeId: w.tb }]),
    ])
    const seen = await Promise.all([hidden, missing, notUuid].map(async (r) => strip(r, await r.text())))
    expect(seen[0]).toMatchObject({ status: 404, code: "not_found" })
    for (const s of seen) expect(s).toEqual(seen[0]) // header parity too
    expect(await w.rows("select 1 from roster_shifts where week_id = $1", [w.wb])).toHaveLength(0)
  })

  test("a shift type of another location, an archived one, a date outside the week and bad bodies are 422; a read-only role is 403", async () => {
    const w = await sites()
    const bad = async (shift: Json, code: string) => expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, { shifts: [shift] }, 422)).code, JSON.stringify(shift)).toBe(code)
    await bad({ date: MON, userIds: [null], shiftTypeId: w.tb }, "invalid_shift_type")
    await bad({ date: MON, userIds: [null], shiftTypeId: "not-a-uuid" }, "invalid_shift_type")
    await bad({ date: "2026-11-09", userIds: [null], shiftTypeId: w.ta }, "invalid_shift")
    await bad({ date: "2026-11-01", userIds: [null], shiftTypeId: w.ta }, "invalid_shift")
    await bad({ date: MON, userIds: [], shiftTypeId: w.ta }, "invalid_shift")
    await bad({ date: MON, userIds: [w.p.employee.userId, w.p.employee.userId], shiftTypeId: w.ta }, "invalid_shift")
    await bad({ date: MON, userIds: [null], shiftTypeId: w.ta, role: "" }, "invalid_shift")
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, { shifts: [] }, 422)).code).toBe("invalid_shift")
    await w.ok("DELETE", `/v1/shift-types/${w.ta}`, w.p.owner, undefined, 204)
    await bad({ date: MON, userIds: [null], shiftTypeId: w.ta }, "invalid_shift_type")
    for (const who of [w.p.employee, w.p.manager]) expect((await w.add(who, w.wa, [{ date: MON, userIds: [null], shiftTypeId: w.tb }])).status).toBe(403)
    expect(await w.rows("select 1 from roster_shifts")).toHaveLength(0)
  })

  test("a retried request or a double click does not duplicate a person's shift: 409 shift_exists; two at once: one wins", async () => {
    const w = await sites()
    const shift = { date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }
    expect((await w.add(w.p.owner, w.wa, [shift])).status).toBe(201)
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, { shifts: [shift] }, 409)).code).toBe("shift_exists")
    const again = { date: "2026-11-03", userIds: [w.staff2.userId], shiftTypeId: w.ta }
    const both = await Promise.all([w.add(w.p.owner, w.wa, [again]), w.add(w.p.owner, w.wa, [again])])
    expect(both.map((r) => r.status).sort()).toEqual([201, 409])
    expect(await w.rows("select 1 from roster_shifts where user_id = $1", [w.staff2.userId])).toHaveLength(1)
  })
})

describe("eligibility is always 422 ineligible, whatever the rule severities", () => {
  test("a deactivated member (left) and an unknown user", async () => {
    const w = await sites()
    await w.ok("POST", `/v1/members/${w.staff2.userId}/deactivate`, w.p.owner)
    await w.rules(w.p.owner, { severity: { left: "ignore" } }) // the tenant switched the rule off: still ineligible
    const left = await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, { shifts: [{ date: MON, userIds: [w.staff2.userId], shiftTypeId: w.ta }] }, 422)
    expect(left).toMatchObject({ code: "ineligible", errors: [{ userId: w.staff2.userId, reason: "left" }] })
    const ghost = await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, { shifts: [{ date: MON, userIds: ["usr_ghost"], shiftTypeId: w.ta }] }, 422)
    expect(ghost.errors).toEqual([{ userId: "usr_ghost", date: MON, reason: "left" }]) // a missing person reads like a left one (no oracle)
  })

  test("a missing and an expired required qualification; a held one (through its expiry date) passes", async () => {
    const w = await sites()
    const guard = await w.type(w.a, "Armed", { requires: ["SIA Licence"] })
    const shift = (u: string, date = MON) => ({ shifts: [{ date, userIds: [u], shiftTypeId: guard }] })
    const missing = await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, shift(w.p.employee.userId), 422)
    expect(missing.errors).toEqual([{ userId: w.p.employee.userId, date: MON, reason: "qualification_missing", qualification: "sia licence" }])
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "sia licence", expiresOn: "2026-11-03" }] })
    const expired = await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, shift(w.p.employee.userId, "2026-11-04"), 422)
    expect(expired.errors).toEqual([{ userId: w.p.employee.userId, date: "2026-11-04", reason: "qualification_expired", qualification: "sia licence" }])
    expect((await w.add(w.p.owner, w.wa, shift(w.p.employee.userId, "2026-11-03").shifts)).status).toBe(201) // valid through the expiry day
  })
})

describe("the rule gate runs inside the write (FR-RS-44)", () => {
  const overlap = async (w: Awaited<ReturnType<typeof sites>>) => {
    const early = await w.type(w.a, "Early", { start: "06:00", end: "14:00" })
    await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    return early
  }

  test("a new double booking is 422 rule_blocked with the violations for a supervisor and for an office role without a reason; nothing is written", async () => {
    const w = await sites()
    const early = await overlap(w)
    const entry = { shifts: [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: early }] }
    for (const who of [w.p["location-supervisor"], w.p.owner]) {
      const r = await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, who, entry, 422)
      expect(r.code).toBe("rule_blocked")
      expect(r.violations.map((v: Json) => v.rule)).toContain("double_booking")
    }
    // a supervisor's reason does not help: only an office role may override
    expect((await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p["location-supervisor"], { ...entry, reason: "needed" }, 422)).code).toBe("rule_blocked")
    expect(await w.rows("select 1 from roster_shifts")).toHaveLength(1)
  })

  test("an office role with a reason overrides the block; the override is in history and audit", async () => {
    const w = await sites()
    const early = await overlap(w)
    const r = await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: early }], { reason: "Cover for sickness" })
    expect(r.violations.some((v: Json) => v.rule === "double_booking" && v.severity === "block")).toBe(true)
    const [h] = await w.rows("select reason, after from roster_history where shift_id = $1", [r.shifts[0].id])
    expect(h.reason).toBe("Cover for sickness")
    expect(h.after.overrides.map((o: Json) => o.rule)).toContain("double_booking")
    expect(await w.rows("select 1 from audit_events where action = 'roster.shift_added'")).toHaveLength(2)
  })

  test("a warning never stops a draft edit and comes back in the body", async () => {
    const w = await sites()
    await w.addOk(w.p.owner, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    const r = await w.addOk(w.p["location-supervisor"], w.wa, [{ date: "2026-11-03", userIds: [w.p.employee.userId], shiftTypeId: w.ta, start: "02:00", end: "10:00" }]) // 10 h rest
    expect(r.violations.map((v: Json) => [v.rule, v.severity])).toContainEqual(["daily_rest", "warn"])
    // a violation that already existed is not reported again for an unrelated change
    const r2 = await w.addOk(w.p.owner, w.wa, [{ date: "2026-11-06", userIds: [w.staff2.userId], shiftTypeId: w.ta }])
    expect(r2.violations).toEqual([])
  })

  test("a person double-booked at a site the supervisor cannot see is blocked with the generic line only", async () => {
    const w = await sites()
    await w.addOk(w.p.owner, w.wb, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.tb }])
    const r = await w.fail("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p["location-supervisor"], { shifts: [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta }] }, 422)
    expect(r.violations.map((v: Json) => [v.rule, v.message])).toEqual([["elsewhere", "Already rostered elsewhere"]])
    const text = JSON.stringify(r)
    for (const hidden of [w.b, w.wb, w.tb, "Bravo"]) expect(text.includes(hidden), hidden).toBe(false)
  })
})

describe("change a shift (FR-RS-10)", () => {
  const one = async (w: Awaited<ReturnType<typeof sites>>, who = w.p.owner, o: Json = {}) => (await w.addOk(who, w.wa, [{ date: MON, userIds: [w.p.employee.userId], shiftTypeId: w.ta, ...o }])).shifts[0]

  test("PATCH needs version; a stale one is 409 version_conflict and writes nothing", async () => {
    const w = await sites()
    const s = await one(w)
    expect((await w.req("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { patch: { start: "09:00" } })).status).toBe(400) // schema: version is required
    expect((await w.fail("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 7, patch: { start: "09:00" } }, 409)).code).toBe("version_conflict")
    expect((await w.rows("select start_time from roster_shifts where id = $1", [s.id]))[0].start_time).toBe("08:00")
    const ok = await w.ok("PATCH", `/v1/roster/shifts/${s.id}`, w.p["location-supervisor"], { version: s.version, patch: { start: "09:00", end: "17:00" } })
    expect(ok.shift).toMatchObject({ start: "09:00", end: "17:00", version: 2, startAt: "2026-11-02T09:00:00.000Z" })
    const [h] = await w.rows("select action, before, after from roster_history where shift_id = $1 and action = 'shift_moved'", [s.id])
    expect(h.before).toMatchObject({ start: "08:00", end: "16:00" })
    expect(h.after).toMatchObject({ start: "09:00", end: "17:00" })
  })

  test("two concurrent PATCH of one shift on the same version: one wins, the other is 409 version_conflict (no lost update)", async () => {
    const w = await sites()
    const s = await one(w)
    const rs = await Promise.all(["09:00", "10:00"].map((start) => w.req("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 1, patch: { start, end: "18:00" } })))
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409])
    const winner = (await w.rows("select start_time, version from roster_shifts where id = $1", [s.id]))[0]
    expect(winner.version).toBe(2)
    const body = JSON.parse(await (rs.find((r) => r.status === 200)!).text()) as Json
    expect(body.shift.start).toBe(winner.start_time)
  })

  test("moving a shift to another week is 422 cannot_move_week; a patch of nothing or an unknown key is 422 invalid_patch; no change writes nothing", async () => {
    const w = await sites()
    const s = await one(w)
    const bad = async (patch: Json, code: string) => expect((await w.fail("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 1, patch }, 422)).code, JSON.stringify(patch)).toBe(code)
    await bad({ date: "2026-11-09" }, "cannot_move_week")
    await bad({ weekId: w.wb }, "cannot_move_week")
    await bad({ locationId: w.b }, "cannot_move_week")
    await bad({ confirmedAt: "2026-11-02T00:00:00Z" }, "invalid_patch")
    await bad({}, "invalid_patch")
    await bad({ date: "nonsense" }, "invalid_patch")
    await bad({ unpaidBreakMin: "30" }, "invalid_patch")
    await bad({ start: "25:00" }, "invalid_shift")
    const same = await w.ok("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 1, patch: { start: "08:00" } })
    expect(same.shift.version).toBe(1)
    expect(await w.rows("select 1 from roster_history where shift_id = $1 and action = 'shift_moved'", [s.id])).toHaveLength(0)
  })

  test("changing the person re-runs eligibility; unassigning makes an open shift; retyping copies the type's times unless the patch gives them", async () => {
    const w = await sites()
    const s = await one(w)
    await w.ok("POST", `/v1/members/${w.staff2.userId}/deactivate`, w.p.owner)
    expect((await w.fail("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 1, patch: { userId: w.staff2.userId } }, 422)).code).toBe("ineligible")
    const guard = await w.type(w.a, "Armed", { start: "20:00", end: "23:00", requires: ["firearms"], role: "Armed guard" })
    expect((await w.fail("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 1, patch: { shiftTypeId: guard } }, 422)).errors[0].reason).toBe("qualification_missing")
    const open = await w.ok("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 1, patch: { userId: null } })
    expect(open.shift).toMatchObject({ userId: null, version: 2 })
    await w.ok("PUT", `/v1/members/${w.p.employee.userId}/qualifications`, w.p.owner, { qualifications: [{ type: "firearms", expiresOn: null }] })
    const retyped = await w.ok("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 2, patch: { shiftTypeId: guard, userId: w.p.employee.userId, end: "22:00" } })
    expect(retyped.shift).toMatchObject({ role: "Armed guard", start: "20:00", end: "22:00", shiftTypeId: guard, userId: w.p.employee.userId })
    expect((await w.fail("PATCH", `/v1/roster/shifts/${s.id}`, w.p.owner, { version: 3, patch: { shiftTypeId: w.tb } }, 422)).code).toBe("invalid_shift_type") // another site's type
  })

  test("a move that causes a block is 422 rule_blocked (an office role with a reason overrides); one that causes a warning returns it", async () => {
    const w = await sites()
    await one(w)
    const s2 = (await w.addOk(w.p.owner, w.wa, [{ date: "2026-11-03", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0]
    const blocked = await w.fail("PATCH", `/v1/roster/shifts/${s2.id}`, w.p["location-supervisor"], { version: 1, patch: { date: MON, reason: "x" } }, 422)
    expect(blocked.code).toBe("invalid_patch") // a reason belongs beside the patch, not in it
    const b2 = await w.fail("PATCH", `/v1/roster/shifts/${s2.id}`, w.p["location-supervisor"], { version: 1, patch: { date: MON, start: "09:00", end: "17:00" }, reason: "needed" }, 422)
    expect(b2.code).toBe("rule_blocked")
    expect(b2.violations.map((v: Json) => v.rule)).toContain("double_booking")
    expect((await w.rows("select date::text as date from roster_shifts where id = $1", [s2.id]))[0].date).toBe("2026-11-03") // nothing moved
    const forced = await w.ok("PATCH", `/v1/roster/shifts/${s2.id}`, w.p.owner, { version: 1, patch: { date: MON, start: "09:00", end: "17:00" }, reason: "Double cover for the audit" })
    expect(forced.violations.some((v: Json) => v.rule === "double_booking")).toBe(true)
    const [h] = await w.rows("select reason, after from roster_history where shift_id = $1 and action = 'shift_moved'", [s2.id])
    expect(h.reason).toBe("Double cover for the audit")
    expect(h.after.overrides.map((o: Json) => o.rule)).toContain("double_booking")
    // a warning: 10 hours of rest
    const s3 = (await w.addOk(w.p.owner, w.wa, [{ date: "2026-11-05", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0]
    const warn = await w.ok("PATCH", `/v1/roster/shifts/${s3.id}`, w.p["location-supervisor"], { version: 1, patch: { date: "2026-11-03", start: "02:00", end: "07:00" } })
    expect(warn.violations.map((v: Json) => [v.rule, v.severity])).toContainEqual(["daily_rest", "warn"])
  })

  test("DELETE of a shift in a draft writes history with the whole shift as before and removes the row", async () => {
    const w = await sites()
    const s = await one(w, w.p["location-supervisor"])
    expect((await w.fail("DELETE", `/v1/roster/shifts/${s.id}?version=9`, w.p["location-supervisor"], undefined, 409)).code).toBe("version_conflict")
    expect((await w.req("DELETE", `/v1/roster/shifts/${s.id}?version=1`, w.p["location-supervisor"])).status).toBe(204)
    expect(await w.rows("select 1 from roster_shifts where id = $1", [s.id])).toHaveLength(0)
    const [h] = await w.rows("select action, before, after, actor_id from roster_history where shift_id = $1 and action = 'shift_removed'", [s.id])
    expect(h.before).toMatchObject({ shiftId: s.id, userId: w.p.employee.userId, date: MON, start: "08:00", end: "16:00", unpaidBreakMin: 0, shiftTypeId: w.ta })
    expect(h.after).toBeNull()
    expect(h.actor_id).toBe(w.p["location-supervisor"].userId)
    expect(await w.rows("select 1 from audit_events where action = 'roster.shift_removed'")).toHaveLength(1)
    expect((await w.req("DELETE", `/v1/roster/shifts/${s.id}`, w.p.owner)).status).toBe(404) // gone
  })

  test("a hidden shift, a missing one and a non-uuid id answer one identical 404 on PATCH and DELETE; the hidden shift is untouched", async () => {
    const w = await sites()
    const hiddenShift = (await w.addOk(w.p.owner, w.wb, [{ date: MON, userIds: [w.staff2.userId], shiftTypeId: w.tb }])).shifts[0]
    const sup = w.p["location-supervisor"]
    const ids = [hiddenShift.id, "00000000-0000-4000-8000-000000000000", "nope", "x' or '1'='1"]
    for (const [method, body] of [["PATCH", { version: 1, patch: { start: "09:00" } }], ["DELETE", undefined]] as const) {
      const seen: ReturnType<typeof strip>[] = []
      for (const id of ids) {
        const r = await w.req(method, `/v1/roster/shifts/${encodeURIComponent(id)}`, sup, body)
        seen.push(strip(r, await r.text()))
      }
      expect(seen[0], method).toMatchObject({ status: 404, code: "not_found" })
      for (const s of seen) expect(s, method).toEqual(seen[0])
    }
    expect((await w.rows("select start_time, version from roster_shifts where id = $1", [hiddenShift.id]))[0]).toEqual({ start_time: "08:00", version: 1 })
  })

  test("the database ties a shift's location to its week's location: a mismatched pair cannot exist", async () => {
    const w = await sites()
    await expect(
      ownerTenantQuery(w.tenant.id, "insert into roster_shifts (tenant_id, week_id, location_id, date, shift_type_id, role, start_time, end_time, start_at, end_at, created_at, updated_at) values ($1, $2, $3, $4, $5, 'Guard', '08:00', '16:00', now(), now() + interval '8 hours', now(), now())", [w.tenant.id, w.wa, w.b, MON, w.ta]),
    ).rejects.toThrow(/roster_shifts_week_fk|foreign key/)
  })
})

describe("source rules", () => {
  test("weeks.ts and shifts.ts never open their own transaction or take the lock themselves: every write comes through rosterWrite", () => {
    for (const f of ["weeks.ts", "shifts.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
      expect(/withTenant|lockRoster|lockActor|withTenantAfterCommit/.test(src), f).toBe(false)
    }
    const routes = readFileSync(new URL("routes.ts", import.meta.url), "utf8")
    for (const fn of ["createWeek", "addShifts", "patchShift", "deleteShift"]) expect(new RegExp(`rosterWrite\\([^\\n]*${fn}\\(`).test(routes), fn).toBe(true)
    for (const fn of ["listWeeks", "getWeek"]) expect(new RegExp(`rosterRead\\([^\\n]*${fn}\\(`).test(routes), fn).toBe(true)
  })

  test("a non-uuid id never reaches SQL in shifts.ts and weeks.ts: both loaders test isUuid first", () => {
    for (const [f, loader] of [["weeks.ts", "loadWeek"], ["shifts.ts", "loadShift"]] as const) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8")
      const body = src.slice(src.indexOf(`export async function ${loader}`))
      expect(body.slice(0, 400).includes("isUuid"), loader).toBe(true)
    }
  })

  test("the unauthenticated and cross-tenant behaviour of the week routes is the shared one (401 without a cookie)", async () => {
    const w = await sites()
    expect((await call(w.app, "DELETE", `/v1/roster/shifts/00000000-0000-4000-8000-000000000000`, { tenant: "acme" })).status).toBe(401)
  })
})
