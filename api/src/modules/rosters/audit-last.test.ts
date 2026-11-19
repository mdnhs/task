import { beforeEach, describe, expect, test } from "vitest"
import { fakeClock, resetDb } from "../../../test/harness"
import { runAutoRepeatJob } from "./jobs"
import { sites, type Json } from "./testkit"

// B8 final review (R5): the audit line is the LAST write of a roster mutation (the declared order: ... history, notify, audit, publish), also for a repeat of many weeks and for the approval of a
// change request, so the audit lock (the hash chain) is held for the shortest tail of the transaction. Observed through `cmin`, the command counter of the writing transaction: a row written by a
// later statement of the same transaction has a larger cmin.

beforeEach(resetDb)

type W = Awaited<ReturnType<typeof sites>>
const cmins = async (w: W, sql: string, params: unknown[] = []): Promise<number[]> => (await w.rows(`select cmin::text::int as c from (${sql}) t`, params)).map((r) => r.c as number)
const SRC = "2026-12-07"

describe("audit last", () => {
  test("a repeat of 3 weeks writes every shift and every history line first, then the 3 audit lines in week order", async () => {
    const w = await sites()
    const wk = await w.week(w.p.owner, w.a, SRC)
    await w.addOk(w.p.owner, wk, [{ date: SRC, userIds: [w.p.employee.userId], shiftTypeId: w.ta }, { date: "2026-12-08", userIds: [w.staff2.userId], shiftTypeId: w.ta }])
    const v = Number((await w.rows("select version from roster_weeks where id = $1", [wk]))[0].version)
    await w.ok("POST", `/v1/roster/weeks/${wk}/publish`, w.p.owner, { version: v })
    const v2 = Number((await w.rows("select version from roster_weeks where id = $1", [wk]))[0].version)
    await w.ok("POST", `/v1/roster/weeks/${wk}/repeat`, w.p.owner, { version: v2, weeks: 3 }, 201)
    const audit = await w.rows("select entity_id, after->>'weekStart' as ws, cmin::text::int as c from audit_events where action = 'roster.week_repeated' order by seq")
    expect(audit.map((a) => a.ws)).toEqual(["2026-12-14", "2026-12-21", "2026-12-28"]) // one line per week, in order
    const written = await cmins(w, "select cmin from roster_shifts where week_id in (select id from roster_weeks where week_start > '2026-12-07' and location_id = '" + w.a + "') union all select cmin from roster_history where action = 'week_repeated'")
    expect(written.length).toBeGreaterThan(6)
    expect(Math.max(...written)).toBeLessThan(Math.min(...audit.map((a) => a.c))) // no shift, week or history row is written after the first audit line
  })

  test("approving a change request writes the request, history and notice first and both audit lines (shift moved, change decided) after them, in that order", async () => {
    const w = await sites()
    const wk = await w.week(w.p.owner, w.a, "2026-11-23")
    const shift = (await w.addOk(w.p.owner, wk, [{ date: "2026-11-23", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])).shifts[0] as Json
    const v = Number((await w.rows("select version from roster_weeks where id = $1", [wk]))[0].version)
    await w.ok("POST", `/v1/roster/weeks/${wk}/publish`, w.p.owner, { version: v })
    const cur = Number((await w.rows("select version from roster_shifts where id = $1", [shift.id]))[0].version)
    void cur
    const r = await w.ok("POST", `/v1/roster/shifts/${shift.id}/change-requests`, w.p["location-supervisor"], { patch: { start: "09:00", end: "17:00" }, reason: "Venue opens late" }, 201)
    await w.ok("POST", `/v1/roster/change-requests/${r.id}/decide`, w.p.owner, { decision: "approve" })
    const audit = await w.rows("select action, cmin::text::int as c from audit_events where action in ('roster.shift_moved', 'roster.change_decided') order by seq desc limit 2")
    expect(audit.map((a) => a.action)).toEqual(["roster.change_decided", "roster.shift_moved"]) // newest first: moved, then decided
    const first = Math.min(...audit.map((a) => a.c))
    const before = await cmins(
      w,
      "select cmin from roster_change_requests where id = '" + r.id + "' union all select cmin from roster_shifts where id = '" + shift.id + "' union all select cmin from roster_history where action in ('shift_moved', 'change_approved') and shift_id = '" + shift.id + "' union all select cmin from notifications where title = 'Change request approved'",
    )
    expect(before.length).toBeGreaterThanOrEqual(5)
    expect(Math.max(...before)).toBeLessThan(first)
  })

  test("the auto-repeat job writes its audit line after the ledger, the copy, the location update and the notices", async () => {
    const w = await sites({ clock: fakeClock(new Date("2026-12-10T09:00:00.000Z")) })
    const wk = await w.week(w.p.owner, w.a, SRC)
    await w.addOk(w.p.owner, wk, [{ date: SRC, userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    await w.ok("POST", `/v1/roster/weeks/${wk}/publish`, w.p.owner, { version: Number((await w.rows("select version from roster_weeks where id = $1", [wk]))[0].version) })
    await w.ok("PUT", `/v1/roster/weeks/${wk}/auto-repeat`, w.p.owner, { days: 7 })
    await runAutoRepeatJob({}, w.deps)
    const [audit] = await w.rows("select cmin::text::int as c from audit_events where action = 'roster.week_auto_repeated'")
    const before = await cmins(w, "select cmin from roster_auto_repeat_runs union all select cmin from notifications where title = 'Roster draft ready' union all select cmin from roster_history where action = 'week_auto_repeated'")
    expect(before.length).toBe(3)
    expect(Math.max(...before)).toBeLessThan(audit.c)
  })
})
