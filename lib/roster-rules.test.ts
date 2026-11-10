import { describe, expect, it } from "vitest"
import { blocking, checkShifts, type RuleContext, type RuleId } from "./roster-rules"
import type { RosterShift, ShiftTemplate } from "./rosters"
import type { WorkforceMember } from "./workforce"

const TZ = "Europe/Dublin"
const SEV: Record<RuleId, "block" | "warn"> = { double_booking: "block", approved_leave: "block", unavailable: "warn", daily_rest: "warn", weekly_rest: "warn", avg_48h: "warn", expired_licence: "warn", left: "warn" }
const member = (o: Partial<WorkforceMember> = {}): WorkforceMember => ({ id: "p1", name: "Aoife Byrne", role: "Security Officer", dept: "Ops", homeLocationId: "a", qualifications: [], leftOn: null, ...o })
const tpl: ShiftTemplate = { id: "t1", locationId: "a", name: "Door", start: "18:00", end: "02:00", unpaidBreakMin: 0, role: "Security Officer", requires: ["PSA licence"] }
let n = 0
const shift = (date: string, start: string, end: string, o: Partial<RosterShift> = {}): RosterShift =>
  ({ id: `s${++n}`, weekId: "w", locationId: "a", date, personId: "p1", templateId: "t1", role: "Security Officer", start, end, unpaidBreakMin: 0, confirmedAt: null, ...o })
const ctx = (shifts: RosterShift[], o: Partial<RuleContext> = {}): RuleContext => ({
  shifts, members: [member()], leave: [], availability: [], templates: [tpl], severity: SEV, avgWeekReferenceWeeks: 17, tz: TZ, visibleLocationIds: null, ...o,
})
const rules = (target: RosterShift[], c: RuleContext) => checkShifts(target, c).map((v) => v.rule)

describe("daily_rest", () => {
  it("10h between shifts fails and names the person and both shifts", () => {
    const a = shift("2026-11-02", "08:00", "16:00")
    const b = shift("2026-11-03", "02:00", "10:00")
    const v = checkShifts([b], ctx([a, b])).find((x) => x.rule === "daily_rest")!
    expect(v).toBeTruthy()
    expect(v.severity).toBe("warn")
    expect(v.message).toContain("Aoife Byrne")
    expect(v.message).toContain("2026-11-02 08:00")
    expect(v.message).toContain("2026-11-03 02:00")
    expect(v.otherShiftIds).toEqual([a.id])
  })
  it("11h passes", () => {
    const a = shift("2026-11-02", "08:00", "16:00")
    const b = shift("2026-11-03", "03:00", "11:00")
    expect(rules([b], ctx([a, b]))).not.toContain("daily_rest")
  })
  it("is flagged from the earlier shift too", () => {
    const a = shift("2026-11-02", "08:00", "16:00")
    const b = shift("2026-11-03", "02:00", "10:00")
    expect(rules([a], ctx([a, b]))).toContain("daily_rest")
  })
  it("Review Focus 1: Sat 24 Oct 22:00-06:00 is 540 minutes and rest after it is real time", () => {
    const night = shift("2026-10-24", "22:00", "06:00")
    // ends 06:00 Sun 25 Oct (after the clock change, real 9h shift). 17:00 start is 11h real: passes. 16:59 is 10h59: fails.
    const ok = shift("2026-10-25", "17:00", "23:00")
    const bad = shift("2026-10-25", "16:59", "23:00")
    expect(rules([ok], ctx([night, ok]))).not.toContain("daily_rest")
    expect(rules([bad], ctx([night, bad]))).toContain("daily_rest")
  })
  it("autumn change: 10h wall gap that is 11h real passes", () => {
    const a = shift("2026-10-24", "14:00", "22:00")
    const b = shift("2026-10-25", "08:00", "16:00")
    expect(rules([b], ctx([a, b]))).not.toContain("daily_rest")
  })
  it("spring change: 11h wall gap that is 10h real fails", () => {
    const a = shift("2026-03-28", "18:00", "22:00")
    const b = shift("2026-03-29", "09:00", "17:00")
    expect(rules([b], ctx([a, b]))).toContain("daily_rest")
  })
  it("a hidden-site neighbour gives a generic message and no ids", () => {
    const a = shift("2026-11-02", "08:00", "16:00", { locationId: "b" })
    const b = shift("2026-11-03", "02:00", "10:00")
    const v = checkShifts([b], ctx([a, b], { visibleLocationIds: ["a"] })).filter((x) => x.rule === "daily_rest")
    expect(v).toHaveLength(1)
    expect(v[0].message).not.toMatch(/2026-11-02|08:00|16:00|\bb\b/)
    expect(v[0].otherShiftIds).toEqual([])
  })
  it("rest of 10.5h after a Sunday night shift fails", () => {
    // Sun 25 Oct 2026 22:00-06:00 ends 06:00; a 16:30 start is 10.5h later.
    const night = shift("2026-10-25", "22:00", "06:00")
    const next = shift("2026-10-26", "16:30", "23:00")
    expect(rules([next], ctx([night, next]))).toContain("daily_rest")
  })
})

describe("weekly_rest", () => {
  const week = (days: string[]) => days.map((d) => shift(d, "09:00", "17:00"))
  it("seven shifts with no 24h gap fails", () => {
    const s = week(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"])
    expect(rules([s[0]], ctx(s))).toContain("weekly_rest")
  })
  it("six shifts with a free day passes", () => {
    const s = week(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"])
    expect(rules([s[0]], ctx(s))).not.toContain("weekly_rest")
  })
})

describe("weekly_rest across calendar weeks", () => {
  it("Tue-Sun then Mon-Sat breaches the rolling 7 days", () => {
    const days = ["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]
    const s = days.map((d) => shift(d, "09:00", "17:00"))
    const v = checkShifts(s, ctx(s)).filter((x) => x.rule === "weekly_rest")
    expect(v.length).toBeGreaterThan(0)
  })
  it("a hidden-site shift in the window leaks no ids", () => {
    const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]
    const s = days.map((d, i) => shift(d, "09:00", "17:00", i === 3 ? { locationId: "b" } : {}))
    const v = checkShifts([s[0]], ctx(s, { visibleLocationIds: ["a"] })).filter((x) => x.rule === "weekly_rest")
    expect(v).toHaveLength(1)
    expect(v[0].otherShiftIds).not.toContain(s[3].id)
  })
  it("one violation per person per breach, not per shift", () => {
    const days = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]
    const s = days.map((d) => shift(d, "09:00", "17:00"))
    expect(checkShifts(s, ctx(s)).filter((x) => x.rule === "weekly_rest")).toHaveLength(1)
  })
})

describe("avg_48h", () => {
  // 17 weeks ending the week of Mon 2026-11-02: starts Mon 2026-07-13.
  const build = (perWeekShifts: number, hours: number) => {
    const out: RosterShift[] = []
    const base = Date.UTC(2026, 6, 13)
    for (let w = 0; w < 17; w++)
      for (let d = 0; d < perWeekShifts; d++) {
        const date = new Date(base + (w * 7 + d) * 86400000).toISOString().slice(0, 10)
        out.push(shift(date, "08:00", `${String(8 + hours).padStart(2, "0")}:00`))
      }
    return out
  }
  it("exactly 48h average passes", () => {
    const s = build(6, 8)
    expect(rules([s[s.length - 1]], ctx(s))).not.toContain("avg_48h")
  })
  it("above 48h average fails", () => {
    const s = build(6, 8)
    s.push(shift("2026-11-08", "08:00", "09:00"))
    const v = checkShifts([s[s.length - 1]], ctx(s)).find((x) => x.rule === "avg_48h")
    expect(v).toBeTruthy()
    expect(v!.message).toContain("Aoife Byrne")
  })
})

describe("double_booking", () => {
  it("overlap fails, naming person and both shifts at the same location", () => {
    const a = shift("2026-11-02", "18:00", "02:00")
    const b = shift("2026-11-02", "20:00", "03:30")
    const v = checkShifts([b], ctx([a, b])).find((x) => x.rule === "double_booking")!
    expect(v.severity).toBe("block")
    expect(v.message).toContain("Aoife Byrne")
    expect(v.message).toContain("18:00")
    expect(v.message).toContain("20:00")
  })
  it("catches an overlap across midnight", () => {
    const a = shift("2026-11-02", "22:00", "06:00")
    const b = shift("2026-11-03", "05:00", "09:00")
    expect(rules([b], ctx([a, b]))).toContain("double_booking")
  })
  it("back to back is not a double booking", () => {
    const a = shift("2026-11-02", "08:00", "16:00")
    const b = shift("2026-11-02", "16:00", "20:00")
    expect(rules([b], ctx([a, b]))).not.toContain("double_booking")
  })
  it("Review Focus 4: a clash at an invisible site says only 'Already rostered elsewhere'", () => {
    const a = shift("2026-11-02", "18:00", "02:00", { locationId: "b" })
    const b = shift("2026-11-02", "20:00", "03:30")
    const v = checkShifts([b], ctx([a, b], { visibleLocationIds: ["a"] })).find((x) => x.rule === "double_booking")!
    expect(v.message).toBe("Already rostered elsewhere")
    expect(v.message).not.toMatch(/18:00|02:00|loc|\bb\b/)
    expect(v.otherShiftIds).toEqual([])
    expect(blocking(checkShifts([b], ctx([a, b], { visibleLocationIds: ["a"] })))).toHaveLength(1)
  })
})

describe("date rules", () => {
  it("approved leave blocks; requested and rejected do not", () => {
    const s = shift("2026-11-02", "08:00", "16:00")
    const leave = (status: "approved" | "requested" | "rejected") => [{ id: "l", personId: "p1", from: "2026-11-01", to: "2026-11-03", kind: "Annual", status, decidedBy: null, decidedAt: null }]
    expect(rules([s], ctx([s], { leave: leave("approved") }))).toContain("approved_leave")
    expect(rules([s], ctx([s], { leave: leave("requested") }))).not.toContain("approved_leave")
    expect(rules([s], ctx([s], { leave: leave("rejected") }))).not.toContain("approved_leave")
  })
  it("unavailable window on that weekday", () => {
    const s = shift("2026-11-02", "08:00", "16:00") // Monday
    expect(rules([s], ctx([s], { availability: [{ personId: "p1", weekday: 1, from: "12:00", to: "18:00" }] }))).toContain("unavailable")
    expect(rules([s], ctx([s], { availability: [{ personId: "p1", weekday: 2, from: "12:00", to: "18:00" }] }))).not.toContain("unavailable")
    expect(rules([s], ctx([s], { availability: [{ personId: "p1", weekday: 1, from: "16:00", to: "18:00" }] }))).not.toContain("unavailable")
  })
  it("unavailable also tests the next weekday for a shift crossing midnight", () => {
    const s = shift("2026-11-02", "22:00", "06:00") // Monday night into Tuesday
    expect(rules([s], ctx([s], { availability: [{ personId: "p1", weekday: 2, from: "00:00", to: "08:00" }] }))).toContain("unavailable")
    expect(rules([s], ctx([s], { availability: [{ personId: "p1", weekday: 2, from: "07:00", to: "09:00" }] }))).not.toContain("unavailable")
  })
  it("several licence records: passes when any valid one covers the date", () => {
    const s = shift("2026-11-02", "08:00", "16:00")
    const m = member({ qualifications: [{ type: "PSA licence", expires: "2026-01-01" }, { type: "PSA licence", expires: "2027-01-01" }] })
    expect(rules([s], ctx([s], { members: [m] }))).not.toContain("expired_licence")
  })
  it("licence expired before the shift fails; expiring that day passes", () => {
    const s = shift("2026-11-02", "08:00", "16:00")
    const m = (expires: string) => [member({ qualifications: [{ type: "PSA licence", expires }] })]
    expect(rules([s], ctx([s], { members: m("2026-11-01") }))).toContain("expired_licence")
    expect(rules([s], ctx([s], { members: m("2026-11-02") }))).not.toContain("expired_licence")
  })
  it("left member: shift on or after leftOn fails", () => {
    const s = shift("2026-11-02", "08:00", "16:00")
    expect(rules([s], ctx([s], { members: [member({ leftOn: "2026-11-02" })] }))).toContain("left")
    expect(rules([s], ctx([s], { members: [member({ leftOn: "2026-11-03" })] }))).not.toContain("left")
  })
  it("open shifts are never checked", () => {
    const s = shift("2026-11-02", "08:00", "16:00", { personId: null })
    expect(checkShifts([s], ctx([s]))).toEqual([])
  })
})
