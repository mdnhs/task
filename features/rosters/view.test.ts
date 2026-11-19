import { describe, expect, it } from "vitest"
import { LID, LID2, PERSON, SHIFTS, lockedAccess, openAccess, payloadFixture } from "./fixtures"
import { historyWeekOf, violationLines, weekViewData } from "./view"
import type { RosterViewData } from "./view"

const TODAY = "2026-11-04T09:00:00"
const ok = (v: ReturnType<typeof weekViewData>): RosterViewData => {
  if ("denied" in v) throw new Error("denied")
  return v
}

describe("weekViewData: the API payload as the week view", () => {
  it("renders 7 day columns with each person's own start and end (AC-RS-01, AC-RS-02)", () => {
    const v = ok(weekViewData(payloadFixture(), { week: "2026-11-02" }, TODAY))
    const days = v.blocks[0]!.days
    expect(days).toHaveLength(7)
    expect(days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"])
    // two people on the same day keep their OWN times
    expect(days[0]!.shifts.map((s) => [s.person, s.start, s.end])).toEqual([["Ann Byrne", "08:00", "16:00"], ["Ben Walsh", "14:00", "22:00"]])
    // a night shift ends the next day
    expect(days[1]!.shifts[0]).toMatchObject({ person: "Cara Doyle", start: "22:00", end: "06:00", endsNextDay: true })
    expect(days[2]!.shifts[0]).toMatchObject({ person: "Open shift", open: true })
    expect(days[3]!.shifts).toEqual([])
  })

  it("short and over come from the payload's day columns, not from a client count (FR-RS-12)", () => {
    const p = payloadFixture()
    const v = ok(weekViewData(p, { week: "2026-11-02" }, TODAY))
    expect(v.blocks[0]!.days[0]).toMatchObject({ count: 2, target: 4, short: 2, over: 0 })
    expect(v.blocks[0]!.short).toBe(25) // 2 + 3 + 4 + 4 x 4: the sum of the days, as the API counted them
    expect(v.totals).toEqual({ count: 3, target: 28, short: 25, over: 0 })
    const both = ok(weekViewData(payloadFixture({ locations: [LID, LID2] }), { location: "all", week: "2026-11-02" }, TODAY))
    expect(both.totals.short).toBe(25 + 28) // the second site is empty: its whole target is short
    const wk = p.weeks[0]!
    // the API says Monday is over staffed: that is what the view shows, whatever the shifts say
    wk.days[0] = { ...wk.days[0]!, count: 5, target: 2, short: 0, over: 3 }
    const over = ok(weekViewData(p, { week: "2026-11-02" }, TODAY))
    expect(over.blocks[0]!.days[0]).toMatchObject({ short: 0, over: 3 })
    expect(over.totals.over).toBe(3)
  })

  it("controls follow the payload's access per week: editable, locked (read-only) and reason_required (office on a published week)", () => {
    const edit = ok(weekViewData(payloadFixture(), { week: "2026-11-02" }, TODAY))
    expect(edit.blocks[0]!.days.every((d) => d.canEdit && !d.locked)).toBe(true)
    expect(edit.access).toEqual(openAccess)
    const locked = ok(weekViewData(payloadFixture({ status: "published", access: lockedAccess }), { week: "2026-11-02" }, TODAY))
    expect(locked.blocks[0]!.days.every((d) => !d.canEdit && d.locked)).toBe(true)
    expect(locked.blocks[0]!.status).toBe("published")
    const office = ok(weekViewData(payloadFixture({ status: "published", access: { level: "office", canEdit: true, locked: false, lockReason: "reason_required" } }), { week: "2026-11-02" }, TODAY))
    expect(office.blocks[0]!.days.every((d) => d.canEdit && d.reasonRequired)).toBe(true)
    const none = ok(weekViewData(payloadFixture({ access: { level: null, canEdit: false, locked: false, lockReason: "forbidden" } }), { week: "2026-11-02" }, TODAY))
    expect(none.blocks[0]!.days.some((d) => d.canEdit)).toBe(false)
    // a day with no week has no roster and nothing to edit; the block says whether the caller may create the week
    const empty = ok(weekViewData(payloadFixture(), { week: "2026-11-09" }, TODAY))
    expect(empty.blocks[0]!.days.every((d) => !d.hasRoster && !d.canEdit)).toBe(true)
    expect(empty.blocks[0]!.canCreate).toBe(true)
  })

  it("a supervisor with one location sees only that location, no other option and no 'All locations'", () => {
    const v = ok(weekViewData(payloadFixture(), {}, TODAY))
    expect(v.locations).toEqual([{ value: LID, label: "Coppers" }])
    expect(v.location).toBe(LID)
    expect(JSON.stringify(v)).not.toContain("Docklands")
    const many = ok(weekViewData(payloadFixture({ locations: [LID, LID2] }), { location: "all", week: "2026-11-02" }, TODAY))
    expect(many.locations.map((l) => l.value)).toEqual(["all", LID, LID2])
    expect(many.blocks.map((b) => b.name)).toEqual(["Coppers", "Docklands"])
  })

  it("an unknown location or no location at all is denied (the API cut the list; nothing is made up)", () => {
    expect(weekViewData(payloadFixture(), { location: LID2 }, TODAY)).toEqual({ denied: true })
    expect(weekViewData({ ...payloadFixture(), locations: [] }, {}, TODAY)).toEqual({ denied: true })
    expect(weekViewData(payloadFixture(), { location: "all" }, TODAY)).toEqual({ denied: true }) // one visible location: "all" is not an option
  })

  it("ranges and groupings follow the query; by person lists each person once, open shifts last", () => {
    const v = ok(weekViewData(payloadFixture(), { week: "2026-11-02", group: "person" }, TODAY))
    expect(v.groups[0]!.rows.map((r) => r.name)).toEqual(["Ann Byrne", "Ben Walsh", "Cara Doyle", "Open shifts"])
    expect(v.groups[0]!.rows[0]!.cells[0]![0]).toMatchObject({ start: "08:00", end: "16:00" })
    const day = ok(weekViewData(payloadFixture(), { week: "2026-11-02", view: "day" }, TODAY))
    expect(day.dates).toEqual(["2026-11-02"])
    expect(day.next).toBe("2026-11-03")
    const role = ok(weekViewData(payloadFixture(), { week: "2026-11-02", group: "role" }, TODAY))
    expect(role.groups.map((g) => g.label)).toEqual(["Security officer"])
  })

  it("a shift carries what an edit needs (week, version, shift type, break)", () => {
    const s = ok(weekViewData(payloadFixture(), { week: "2026-11-02" }, TODAY)).blocks[0]!.days[0]!.shifts[0]!
    expect(s).toMatchObject({ id: "sh-mon-ann", personId: PERSON.ann, version: 1, unpaidBreakMin: 30, date: "2026-11-02" })
    expect(s.weekId).toBe(SHIFTS[0]!.weekId)
  })
})

describe("violationLines: the API's violations with the person and the shifts named (AC-RS-04 front)", () => {
  it("names the person and each shift (day and times); a shift the caller cannot see is left out, not invented", () => {
    const p = payloadFixture()
    const lines = violationLines(
      [
        { rule: "double_booking", shiftId: "sh-mon-ann", personId: PERSON.ann, severity: "block", message: "Ann Byrne is on two shifts", otherShiftIds: ["sh-mon-ben", "elsewhere-shift"] },
        { rule: "daily_rest", shiftId: "sh-tue-cara", personId: PERSON.cara, severity: "warn", message: "Cara Doyle has 9h rest", otherShiftIds: [] },
      ],
      p,
    )
    expect(lines[0]).toMatchObject({ severity: "block", person: "Ann Byrne", message: "Ann Byrne is on two shifts" })
    expect(lines[0]!.shifts.map((s) => s.label)).toEqual(["Mon 2 Nov 08:00–16:00", "Mon 2 Nov 14:00–22:00"])
    expect(lines[1]).toMatchObject({ severity: "warn", person: "Cara Doyle" })
    expect(lines[1]!.shifts.map((s) => s.label)).toEqual(["Tue 3 Nov 22:00–06:00"])
    expect(lines.map((l) => l.severity)).toEqual(["block", "warn"]) // blocks first
  })
})

describe("historyWeekOf: the week the history panel opens with", () => {
  it("is the shown location's week of the range (the view's own default when none is chosen), not another site's", () => {
    const p = payloadFixture({ locations: [LID, LID2] })
    expect(historyWeekOf(p)?.locationId).toBe(LID) // the first location is what the view shows by default
    expect(historyWeekOf(p, LID2)?.locationId).toBe(LID2)
    expect(historyWeekOf(p, "all")).toBeDefined()
    expect(historyWeekOf({ ...p, weeks: [] }, LID)).toBeUndefined()
  })
})
