import { describe, expect, it } from "vitest"
import { reportDue, reportTiming, type ShiftPattern, type ShiftWindow } from "./shifts"
import { secondsUntil } from "./report-deadline"
import { workingDay } from "./today"

// R8-1: every consumer of wallToEpoch reads a gap wall time as the transition instant and a fold wall time as its first occurrence.
// Each case below gives a different answer under the old "shift a gap by its length" rule.

const win = (start: string, end: string, tz: string): ShiftWindow => ({ patternId: "p", date: start.slice(0, 10), start, end, timeZone: tz, endsNextDay: false, minutes: 0 })
const DUB = "Europe/Dublin"
const LH = "Australia/Lord_Howe"

describe("report timing and deadline countdown (reportTiming, secondsUntil)", () => {
  it("Dublin gap: now 01:30 (= 01:00Z) is before a shift starting 02:15 local (01:15Z); the old rule read it as 01:30Z, inside the shift", () => {
    expect(reportTiming(win("2026-03-29T02:15", "2026-03-29T08:00", DUB), 60, "2026-03-29T01:30")).toBe("upcoming")
    expect(secondsUntil("2026-03-29T02:15", "2026-03-29T01:30", DUB)).toBe(900)
  })
  it("Dublin fold: 01:30 is the first occurrence (00:30Z), 5400 s before 02:00 GMT", () => {
    expect(secondsUntil("2026-10-25T02:00", "2026-10-25T01:30", DUB)).toBe(5400) // 00:30Z to 02:00Z
  })
  it("Lord_Howe gap (30 min): 02:15 reads as 02:30 (15:30Z), 900 s before 02:45", () => {
    expect(reportTiming(win("2026-10-04T02:40", "2026-10-04T08:00", LH), 60, "2026-10-04T02:15")).toBe("upcoming")
    expect(secondsUntil("2026-10-04T02:45", "2026-10-04T02:15", LH)).toBe(900)
  })
  it("Lord_Howe fold: 01:45 is the first occurrence (+11:00, 14:45Z), 2700 s before 02:00 (+10:30, 15:30Z)", () => {
    expect(secondsUntil("2026-04-05T02:00", "2026-04-05T01:45", LH)).toBe(2700)
  })
  it("reportDue adds real minutes: a 00:30 end on the Dublin gap night is due 02:30 local", () => {
    expect(reportDue(win("2026-03-28T22:00", "2026-03-29T00:30", DUB), 60)).toBe("2026-03-29T02:30")
  })
})

describe("workingDay (Today)", () => {
  const p = (tz: string, start: string, day: 0): ShiftPattern => ({ id: "n", name: "Early", team: "T", start, end: "09:00", days: [day], timeZone: tz })
  const asg = [{ personId: "u", patternId: "n", from: "2026-01-01" }]
  it("Dublin gap: a 01:45 pattern on Sun 28 Mar 2027 starts at 01:00Z, so now 01:10 (gap, = 01:00Z) has started it (the old rule: 01:45Z, not yet)", () => {
    expect(workingDay("u", "2027-03-28T01:10", [p(DUB, "01:45", 0)], asg, DUB).hasShift).toBe(true)
  })
  it("Lord_Howe gap: a 02:20 pattern on Sun 4 Oct 2026 starts at 15:30Z, so now 02:10 (= 15:30Z) has started it", () => {
    expect(workingDay("u", "2026-10-04T02:10", [p(LH, "02:20", 0)], asg, LH).hasShift).toBe(true)
  })
})
