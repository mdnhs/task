import { describe, expect, it } from "vitest"
import { dayColumns, rosterRange, shiftEnd, shiftMinutes, type RosterShift, type RosterWeek, type ShiftTemplate, type StaffingTarget } from "./rosters"

const TZ = "Europe/Dublin"
const week: RosterWeek = { id: "w1", locationId: "loc-a", weekStart: "2026-10-19", status: "published", publishedAt: null, publishedBy: null, autoRepeatDays: null }
const tpl: ShiftTemplate = { id: "t1", locationId: "loc-a", name: "Door", start: "18:00", end: "02:00", unpaidBreakMin: 30, role: "Door", requires: [] }
const sh = (id: string, date: string, personId: string | null, start = "18:00", end = "02:00"): RosterShift => ({
  id, weekId: "w1", locationId: "loc-a", date, personId, templateId: "t1", role: "Door", start, end, unpaidBreakMin: 30, confirmedAt: null,
})
const targets: StaffingTarget[] = [{ locationId: "loc-a", templateId: "t1", weekday: 1, count: 2 }]

describe("dayColumns", () => {
  it("returns seven days from the week start", () => {
    const cols = dayColumns(week, [], targets, [tpl])
    expect(cols.map((c) => c.date)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"])
  })
  it("does not count open shifts and reports short against target", () => {
    const cols = dayColumns(week, [sh("a", "2026-10-19", "p1"), sh("b", "2026-10-19", null)], targets, [tpl])
    expect(cols[0]).toMatchObject({ count: 1, target: 2, short: 1, over: 0 })
    expect(cols[0].shifts).toHaveLength(2)
  })
  it("reports over", () => {
    const cols = dayColumns(week, [sh("a", "2026-10-19", "p1"), sh("b", "2026-10-19", "p2"), sh("c", "2026-10-19", "p3")], targets, [tpl])
    expect(cols[0]).toMatchObject({ count: 3, short: 0, over: 1 })
  })
  it("keeps a night shift on its start date", () => {
    const cols = dayColumns(week, [sh("n", "2026-10-19", "p1", "22:00", "06:00")], targets, [tpl])
    expect(cols[0].shifts.map((s) => s.id)).toEqual(["n"])
    expect(cols[1].shifts).toHaveLength(0)
  })
})

describe("shiftMinutes / shiftEnd", () => {
  it("subtracts the unpaid break", () => {
    expect(shiftMinutes({ date: "2026-10-19", start: "09:00", end: "17:00", unpaidBreakMin: 30 }, TZ)).toBe(450)
  })
  it("counts a night shift across midnight", () => {
    expect(shiftMinutes({ date: "2026-10-19", start: "22:00", end: "06:00", unpaidBreakMin: 0 }, TZ)).toBe(480)
  })
  it("counts real time across the clock change", () => {
    expect(shiftMinutes({ date: "2026-10-24", start: "22:00", end: "06:00", unpaidBreakMin: 0 }, TZ)).toBe(540)
  })
  it("shiftEnd is on the next day for a night shift", () => {
    expect(shiftEnd({ date: "2026-10-19", start: "22:00", end: "06:00" }, TZ)).toBe("2026-10-20T06:00")
    expect(shiftEnd({ date: "2026-10-19", start: "09:00", end: "17:00" }, TZ)).toBe("2026-10-19T17:00")
  })
})

describe("rosterRange", () => {
  it("fortnight is 14 days from Monday", () => {
    expect(rosterRange("fortnight", "2026-10-22")).toEqual({ from: "2026-10-19", to: "2026-11-01" })
  })
  it("week, day and month", () => {
    expect(rosterRange("week", "2026-10-22")).toEqual({ from: "2026-10-19", to: "2026-10-25" })
    expect(rosterRange("day", "2026-10-22")).toEqual({ from: "2026-10-22", to: "2026-10-22" })
    expect(rosterRange("month", "2026-10-22")).toEqual({ from: "2026-10-01", to: "2026-10-31" })
  })
})
