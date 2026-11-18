import { describe, expect, it } from "vitest"
import { blocking, checkShifts, type RuleContext, type RuleId } from "./roster-rules"
import type { RosterShift, ShiftTemplate } from "./rosters"
import type { WorkforceMember } from "./contracts"

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
  it("R8-1: a start inside the 28 Mar 2027 gap (01:30) counts from the transition 01:00Z: a 14:05 end leaves 10h55 real rest and fails (the old rule read 11h25)", () => {
    const a = shift("2027-03-27", "08:00", "14:05")
    const b = shift("2027-03-28", "01:30", "09:30")
    expect(rules([b], ctx([a, b]))).toContain("daily_rest")
    const ok = shift("2027-03-27", "08:00", "14:00") // 11h00 exactly to 01:00Z
    expect(rules([b], ctx([ok, b]))).not.toContain("daily_rest")
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

describe("clock changes (R8-1: wallToEpoch is the one DST rule)", () => {
  it("spring forward: 23:30 to 10:30 across Sun 29 Mar 2026 reads 11h on the wall but is 10h real, so daily_rest warns", () => {
    const a = shift("2026-03-28", "15:30", "23:30")
    const b = shift("2026-03-29", "10:30", "18:30")
    const v = checkShifts([b], ctx([a, b])).find((x) => x.rule === "daily_rest")!
    expect(v).toBeTruthy()
    expect(v.message).toContain("10h00 rest")
    expect(v.otherShiftIds).toEqual([a.id])
  })
  it("fall back: 00:30 to 11:30 across Sun 25 Oct 2026 reads 11h but is 12h real, so there is no warning; 10:30 is 11h real and passes, 09:30 is 10h and fails", () => {
    const a = shift("2026-10-24", "16:30", "00:30")
    expect(rules([shift("2026-10-25", "11:30", "19:30")], ctx([a, shift("2026-10-25", "11:30", "19:30")]))).not.toContain("daily_rest")
    const ok = shift("2026-10-25", "10:30", "18:30")
    expect(rules([ok], ctx([a, ok]))).not.toContain("daily_rest")
    const bad = shift("2026-10-25", "09:30", "17:30")
    expect(checkShifts([bad], ctx([a, bad])).find((x) => x.rule === "daily_rest")!.message).toContain("10h00 rest")
  })
  it("a 22:00-06:00 night on Sat 24 Oct 2026 is 9 real hours towards the 48h average, one on Sat 28 Mar 2026 is 7", () => {
    const week = (nightDate: string, others: string[]) => [...others.map((d) => shift(d, "08:00", "16:00")), shift(nightDate, "22:00", "06:00")]
    // five 8h days plus the night in the same ISO week, averaged over one week: 40 + 9 = 49h (fails), 40 + 7 = 47h (passes)
    const fall = week("2026-10-24", ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"])
    const spring = week("2026-03-28", ["2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27"])
    expect(rules([fall[5]], ctx(fall, { avgWeekReferenceWeeks: 1 }))).toContain("avg_48h")
    expect(rules([spring[5]], ctx(spring, { avgWeekReferenceWeeks: 1 }))).not.toContain("avg_48h")
    const hit = checkShifts([fall[5]], ctx(fall, { avgWeekReferenceWeeks: 1 })).find((x) => x.rule === "avg_48h")!
    expect(hit.message).toContain("49.0h")
  })
  it("two shifts of different zones clash in real time (zones per location); without the zone the clash is missed", () => {
    const a = shift("2026-11-02", "08:00", "12:00") // Dublin 08:00-12:00 = 08:00Z-12:00Z
    const b = shift("2026-11-02", "04:00", "08:00", { locationId: "b" }) // New York 04:00-08:00 EST = 09:00Z-13:00Z
    expect(rules([a], ctx([a, b], { zones: { a: TZ, b: "America/New_York" } }))).toContain("double_booking")
    expect(rules([a], ctx([a, b]))).not.toContain("double_booking")
  })
})

describe("severity from the tenant setting", () => {
  it("ignore drops the violation; block and warn are reported as set", () => {
    const a = shift("2026-11-02", "18:00", "02:00")
    const b = shift("2026-11-02", "20:00", "03:30")
    const sev = (o: Partial<Record<RuleId, "block" | "warn" | "ignore">>) => ({ ...SEV, ...o })
    expect(rules([b], ctx([a, b], { severity: sev({ double_booking: "ignore" }) }))).not.toContain("double_booking")
    expect(checkShifts([b], ctx([a, b], { severity: sev({ double_booking: "warn" }) })).find((x) => x.rule === "double_booking")!.severity).toBe("warn")
    expect(checkShifts([b], ctx([a, b], { severity: sev({ daily_rest: "block" }) })).filter((x) => x.rule === "daily_rest").every((x) => x.severity === "block")).toBe(true)
  })
})

describe("avg_48h and a caller who does not see every location", () => {
  const over = () => {
    const out: RosterShift[] = []
    for (let w = 0; w < 17; w++) for (let d = 0; d < 6; d++) out.push(shift(new Date(Date.UTC(2026, 6, 13) + (w * 7 + d) * 86400000).toISOString().slice(0, 10), "08:00", "16:00", { locationId: d === 5 ? "b" : "a" }))
    out.push(shift("2026-11-08", "08:00", "09:00"))
    return out
  }
  it("carries the hour total for a caller who sees every location and none for one who does not", () => {
    const s = over()
    const full = checkShifts([s[s.length - 1]], ctx(s, { visibleLocationIds: null })).find((x) => x.rule === "avg_48h")!
    expect(full.message).toMatch(/\d+\.\dh a week/)
    const cut = checkShifts([s[s.length - 1]], ctx(s, { visibleLocationIds: ["a"] })).find((x) => x.rule === "avg_48h")!
    expect(cut.message).not.toMatch(/\d/) // no number at all: not the total, the window or the limit
    expect(cut.message).toContain("Aoife Byrne")
    expect(cut.otherShiftIds).toEqual([])
  })
  it("a hidden site's hours still count towards the average", () => {
    const s = over()
    expect(rules([s[s.length - 1]], ctx(s, { visibleLocationIds: ["a"] }))).toContain("avg_48h")
  })
})

describe("leave and availability wording for a caller who does not see every location", () => {
  const s = shift("2026-11-02", "08:00", "16:00")
  const leave = [{ id: "l", personId: "p1", from: "2026-11-01", to: "2026-11-03", kind: "Annual", status: "approved" as const, decidedBy: null, decidedAt: null }]
  const away = [{ personId: "p1", weekday: 1 as const, from: "12:00", to: "18:00" }]
  it("a full caller gets the dates and the window, a cut caller only that it applies", () => {
    const text = (c: RuleContext, rule: RuleId) => checkShifts([s], c).find((x) => x.rule === rule)!.message
    expect(text(ctx([s], { leave }), "approved_leave")).toContain("2026-11-01")
    expect(text(ctx([s], { leave, visibleLocationIds: ["a"] }), "approved_leave")).toBe("Aoife Byrne has approved leave on that day")
    expect(text(ctx([s], { availability: away }), "unavailable")).toContain("12:00-18:00")
    expect(text(ctx([s], { availability: away, visibleLocationIds: ["a"] }), "unavailable")).toBe("Aoife Byrne is unavailable at that time")
  })
})

