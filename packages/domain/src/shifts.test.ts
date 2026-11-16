import { describe, expect, it } from "vitest"
import {
  addDays,
  assign,
  deletePattern,
  nextPatternId,
  ownShiftState,
  setOverride,
  setTeamDefault,
  toggleReporting,
  unassign,
  upsertPattern,
  addMinutes,
  crossesMidnight,
  currentShift,
  daysLabel,
  directReports,
  durationLabel,
  epochToWall,
  isAssignedOn,
  isHm,
  isTimeZone,
  lastEndedShift,
  managerOf,
  minutesBetween,
  onTeam,
  patternTimeLabel,
  primaryTeam,
  reportDue,
  reportPromptFor,
  reportTiming,
  reportsFor,
  shiftKey,
  shiftWindow,
  shiftsFor,
  shiftsOn,
  wallToEpoch,
  weekDates,
  weekStart,
  weekdayOf,
} from "./shifts"
import type { ReportingSettings, ShiftAssignment, ShiftPattern, ShiftState, TeamMember } from "./shifts"

// The seed org zone (public/data/shell/org.json).
const TZ = "Europe/Dublin"
const day: ShiftPattern = { id: "day", name: "Day", team: "Security", start: "07:00", end: "15:00", days: [1, 2, 3, 4, 5] }
const night: ShiftPattern = { id: "night", name: "Night", team: "Security", start: "22:00", end: "07:00", days: [0, 1, 2, 3, 4, 5, 6] }
const eve: ShiftPattern = { id: "eve", name: "Evening", team: "Cleaning", start: "17:00", end: "23:00", days: [1, 2, 3, 4, 5] }
const patterns = [day, night, eve]
const assignments: ShiftAssignment[] = [
  { personId: "a", patternId: "day", from: "2026-10-01" },
  { personId: "b", patternId: "night", from: "2026-10-01" },
  { personId: "c", patternId: "eve", from: "2026-10-01", until: "2026-10-20" },
  { personId: "c", patternId: "night", from: "2026-10-21" },
  { personId: "d", patternId: "day", from: "2026-10-01" },
  { personId: "d", patternId: "eve", from: "2026-10-01" },
]
const members: TeamMember[] = [
  { personId: "m", teams: ["Security", "Cleaning"], managerId: null },
  { personId: "a", teams: ["Security"], managerId: "m" },
  { personId: "b", teams: ["Security"], managerId: "m" },
  { personId: "c", teams: ["Cleaning"], managerId: "m" },
  { personId: "d", teams: ["Cleaning", "Security"], managerId: "c" },
]
const reporting: ReportingSettings = { dueAfterMinutes: 60, teamDefaults: { Security: true, Cleaning: false }, overrides: { b: false, c: true } }

describe("date helpers", () => {
  it("weekday and week start (Monday)", () => {
    expect(weekdayOf("2026-10-20")).toBe(2) // Tuesday
    expect(weekdayOf("2026-10-25T23:00")).toBe(0)
    expect(weekStart("2026-10-20")).toBe("2026-10-19")
    expect(weekStart("2026-10-25")).toBe("2026-10-19")
    expect(weekStart("2026-10-19")).toBe("2026-10-19")
    expect(weekStart("2026-10-20", 0)).toBe("2026-10-18")
    expect(weekDates("2026-10-19")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"])
  })
  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
  })
  it("validates HH:MM and zones", () => {
    expect(isHm("07:00")).toBe(true)
    expect(isHm("23:59")).toBe(true)
    expect(isHm("24:00")).toBe(false)
    expect(isHm("7:00")).toBe(false)
    expect(isTimeZone("Europe/Dublin")).toBe(true)
    expect(isTimeZone("Mars/Base")).toBe(false)
  })
})

describe("time zones", () => {
  it("round-trips wall time", () => {
    expect(epochToWall(wallToEpoch("2026-10-20T09:00", TZ), TZ)).toBe("2026-10-20T09:00")
    expect(wallToEpoch("2026-10-20T09:00", TZ)).toBe(Date.UTC(2026, 9, 20, 8, 0)) // IST (Irish summer time)
    expect(wallToEpoch("2026-12-20T09:00", TZ)).toBe(Date.UTC(2026, 11, 20, 9, 0)) // GMT (Irish winter time)
  })
  it("spring-forward gap moves forward", () => {
    // 29 Mar 2026: 01:00 GMT -> 02:00 IST, so 01:30 does not exist
    expect(epochToWall(wallToEpoch("2026-03-29T01:30", TZ), TZ)).toBe("2026-03-29T02:30")
  })
  it("fall-back ambiguity takes the earlier instant", () => {
    // 25 Oct 2026: 02:00 IST -> 01:00 GMT, 01:30 happens twice
    expect(wallToEpoch("2026-10-25T01:30", TZ)).toBe(Date.UTC(2026, 9, 25, 0, 30))
  })
  it("adds real minutes across DST", () => {
    expect(addMinutes("2026-10-25T00:30", 120, TZ)).toBe("2026-10-25T01:30") // 00:30 IST + 2h = 01:30 GMT
    expect(minutesBetween("2026-10-24T22:00", "2026-10-25T07:00", TZ)).toBe(600)
    expect(minutesBetween("2026-03-28T22:00", "2026-03-29T07:00", TZ)).toBe(480)
  })
  it("works far from the tenant zone", () => {
    expect(epochToWall(wallToEpoch("2026-11-01T01:30", "America/New_York"), "America/New_York")).toBe("2026-11-01T01:30")
    expect(wallToEpoch("2026-10-20T09:00", "Asia/Kolkata")).toBe(Date.UTC(2026, 9, 20, 3, 30))
  })
})

describe("shiftWindow", () => {
  it("day shift stays on its date", () => {
    expect(shiftWindow(day, "2026-10-20", TZ)).toEqual({
      patternId: "day", date: "2026-10-20", start: "2026-10-20T07:00", end: "2026-10-20T15:00", timeZone: TZ, endsNextDay: false, minutes: 480,
    })
  })
  it("night shift ends next day", () => {
    const w = shiftWindow(night, "2026-10-20", TZ)
    expect(w.start).toBe("2026-10-20T22:00")
    expect(w.end).toBe("2026-10-21T07:00")
    expect(w.endsNextDay).toBe(true)
    expect(w.minutes).toBe(540)
    expect(crossesMidnight(night)).toBe(true)
    expect(crossesMidnight(day)).toBe(false)
  })
  it("night shift across month end", () => {
    expect(shiftWindow(night, "2026-10-31", TZ).end).toBe("2026-11-01T07:00")
  })
  it("night shift on DST change nights has real length", () => {
    expect(shiftWindow(night, "2026-10-24", TZ).minutes).toBe(600) // clocks back
    expect(shiftWindow(night, "2026-03-28", TZ).minutes).toBe(480) // clocks forward
    expect(shiftWindow(night, "2026-10-24", TZ).end).toBe("2026-10-25T07:00")
  })
  it("end equal to start is a 24h shift", () => {
    const w = shiftWindow({ ...day, start: "08:00", end: "08:00" }, "2026-10-20", TZ)
    expect(w.end).toBe("2026-10-21T08:00")
    expect(w.minutes).toBe(1440)
  })
  it("converts a pattern in another zone to tenant time", () => {
    const ny: ShiftPattern = { ...day, id: "ny", start: "09:00", end: "17:00", timeZone: "America/New_York" }
    const w = shiftWindow(ny, "2026-10-20", TZ)
    expect(w.start).toBe("2026-10-20T14:00")
    expect(w.end).toBe("2026-10-20T22:00")
    expect(w.timeZone).toBe(TZ)
  })
  it("pattern zone can push the end over tenant midnight", () => {
    const ny: ShiftPattern = { ...day, id: "ny", start: "16:00", end: "22:00", timeZone: "America/New_York" }
    const w = shiftWindow(ny, "2026-10-20", TZ)
    expect(w.end).toBe("2026-10-21T03:00")
    expect(w.endsNextDay).toBe(true)
    expect(crossesMidnight(ny)).toBe(false)
  })
})

describe("assignments and shiftsOn", () => {
  it("from/until are inclusive", () => {
    const a = assignments[2]
    expect(isAssignedOn(a, "2026-10-01")).toBe(true)
    expect(isAssignedOn(a, "2026-10-20")).toBe(true)
    expect(isAssignedOn(a, "2026-10-21")).toBe(false)
    expect(isAssignedOn(a, "2026-09-30")).toBe(false)
  })
  it("lists shifts starting that day, sorted by start", () => {
    const tue = shiftsOn("2026-10-20", patterns, assignments, TZ)
    expect(tue.map((o) => `${o.personId}:${o.pattern.id}`)).toEqual(["a:day", "d:day", "c:eve", "d:eve", "b:night"])
  })
  it("respects days and the assignment switch", () => {
    const wed = shiftsOn("2026-10-21", patterns, assignments, TZ)
    expect(wed.map((o) => `${o.personId}:${o.pattern.id}`)).toEqual(["a:day", "d:day", "d:eve", "b:night", "c:night"])
    const sat = shiftsOn("2026-10-24", patterns, assignments, TZ)
    expect(sat.map((o) => o.personId)).toEqual(["b", "c"])
  })
  it("ignores unknown patterns", () => {
    expect(shiftsOn("2026-10-20", patterns, [{ personId: "x", patternId: "gone", from: "2026-01-01" }], TZ)).toEqual([])
  })
  it("shiftsFor covers a range", () => {
    expect(shiftsFor("c", "2026-10-19", "2026-10-22", patterns, assignments, TZ).map((o) => o.window.date + o.pattern.id)).toEqual([
      "2026-10-19eve", "2026-10-20eve", "2026-10-21night", "2026-10-22night",
    ])
  })
  it("shiftKey is stable", () => {
    expect(shiftKey("b", shiftWindow(night, "2026-10-20", TZ))).toBe("b:night:2026-10-20")
  })
})

describe("currentShift / lastEndedShift", () => {
  it("finds yesterday's night shift after midnight", () => {
    const o = currentShift("b", "2026-10-21T03:00", patterns, assignments, TZ)
    expect(o?.window.date).toBe("2026-10-20")
  })
  it("start inclusive, end exclusive", () => {
    expect(currentShift("a", "2026-10-20T07:00", patterns, assignments, TZ)?.pattern.id).toBe("day")
    expect(currentShift("a", "2026-10-20T15:00", patterns, assignments, TZ)).toBeNull()
    expect(currentShift("a", "2026-10-20T06:59", patterns, assignments, TZ)).toBeNull()
  })
  it("someone off shift has none", () => {
    expect(currentShift("a", "2026-10-24T10:00", patterns, assignments, TZ)).toBeNull()
  })
  it("last ended shift", () => {
    expect(lastEndedShift("b", "2026-10-21T08:00", patterns, assignments, TZ)?.window.date).toBe("2026-10-20")
    expect(lastEndedShift("b", "2026-10-21T06:00", patterns, assignments, TZ)?.window.date).toBe("2026-10-19")
    expect(lastEndedShift("a", "2026-10-26T09:00", patterns, assignments, TZ)?.window.date).toBe("2026-10-23")
    expect(lastEndedShift("zz", "2026-10-26T09:00", patterns, assignments, TZ)).toBeNull()
  })
})

describe("reporting", () => {
  it("team default and overrides (Q5)", () => {
    expect(reportsFor("a", members, reporting)).toEqual({ on: true, source: "team", team: "Security" })
    expect(reportsFor("b", members, reporting)).toEqual({ on: false, source: "override", team: "Security" })
    expect(reportsFor("c", members, reporting)).toEqual({ on: true, source: "override", team: "Cleaning" })
    expect(reportsFor("d", members, reporting)).toEqual({ on: false, source: "team", team: "Cleaning" })
  })
  it("a multi-team member follows the shift's team", () => {
    expect(reportsFor("d", members, reporting, "Security").on).toBe(true)
    expect(reportsFor("d", members, reporting, "Cleaning").on).toBe(false)
  })
  it("no line and no default = off", () => {
    expect(reportsFor("zz", members, reporting)).toEqual({ on: false, source: "team", team: null })
    expect(reportsFor("a", members, { ...reporting, teamDefaults: {} }).on).toBe(false)
  })
  it("report due is real minutes after the end (Q7)", () => {
    expect(reportDue(shiftWindow(night, "2026-10-20", TZ), 60)).toBe("2026-10-21T08:00")
    expect(reportDue(shiftWindow({ ...eve, end: "23:30" }, "2026-10-20", TZ), 60)).toBe("2026-10-21T00:30")
    // ends 00:30 IST on 25 Oct (23:30Z); +120 real minutes = 01:30Z = 01:30 GMT (wall time only moved 1h)
    expect(reportDue(shiftWindow({ ...eve, start: "18:00", end: "00:30" }, "2026-10-24", TZ), 120)).toBe("2026-10-25T01:30")
  })
  it("report timing", () => {
    const w = shiftWindow(day, "2026-10-20", TZ)
    expect(reportTiming(w, 60, "2026-10-20T06:00")).toBe("upcoming")
    expect(reportTiming(w, 60, "2026-10-20T10:00")).toBe("in_shift")
    expect(reportTiming(w, 60, "2026-10-20T15:00")).toBe("open")
    expect(reportTiming(w, 60, "2026-10-20T16:00")).toBe("open")
    expect(reportTiming(w, 60, "2026-10-20T16:01")).toBe("missing")
    expect(reportTiming(w, 60, "2026-10-20T18:00", "2026-10-20T15:30")).toBe("on_time")
    expect(reportTiming(w, 60, "2026-10-20T18:00", "2026-10-20T17:00")).toBe("late")
  })
  it("prompt hook (FR-M1-22)", () => {
    const data = { patterns, assignments, members, reporting }
    const p = reportPromptFor("a", "2026-10-20T15:10", data, TZ)
    expect(p?.key).toBe("a:day:2026-10-20")
    expect(p?.due).toBe("2026-10-20T16:00")
    expect(p?.timing).toBe("open")
    expect(reportPromptFor("a", "2026-10-20T15:10", data, TZ, new Set(["a:day:2026-10-20"]))).toBeNull()
    expect(reportPromptFor("b", "2026-10-21T08:00", data, TZ)).toBeNull() // override off
    expect(reportPromptFor("d", "2026-10-20T15:10", data, TZ)?.shift.pattern.team).toBe("Security") // on via the shift's team
    expect(reportPromptFor("d", "2026-10-20T23:10", data, TZ)).toBeNull() // Cleaning evening: off
  })
})

describe("reporting lines (FR-M0-07)", () => {
  it("manager, reports, teams", () => {
    expect(managerOf("a", members)).toBe("m")
    expect(managerOf("m", members)).toBeNull()
    expect(managerOf("zz", members)).toBeNull()
    expect(directReports("m", members)).toEqual(["a", "b", "c"])
    expect(primaryTeam("d", members)).toBe("Cleaning")
    expect(onTeam("d", members, "Security")).toBe(true)
    expect(onTeam("a", members, "Cleaning")).toBe(false)
    expect(onTeam("a", members, "all")).toBe(true)
  })
})

describe("labels", () => {
  it("time, days, duration", () => {
    expect(patternTimeLabel(night)).toBe("22:00–07:00 +1")
    expect(patternTimeLabel(day)).toBe("07:00–15:00")
    expect(daysLabel([1, 2, 3, 4, 5])).toBe("Mon–Fri")
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("Every day")
    expect(daysLabel([6, 0])).toBe("Sat, Sun")
    expect(daysLabel([1, 3, 5])).toBe("Mon, Wed, Fri")
    expect(daysLabel([5, 6, 0])).toBe("Fri–Sun")
    expect(daysLabel([0, 1, 2, 3, 4])).toBe("Sun–Thu")
    expect(daysLabel([6, 0, 1])).toBe("Sat–Mon")
    expect(daysLabel([1, 2, 4, 5])).toBe("Mon, Tue, Thu, Fri")
    expect(daysLabel([])).toBe("No days")
    expect(durationLabel(480)).toBe("8h")
    expect(durationLabel(450)).toBe("7h 30m")
  })
})


const state: ShiftState = { patterns, assignments, members, reporting }

describe("ownShiftState (payload scoping)", () => {
  it("keeps only the person's own data", () => {
    const s = ownShiftState(state, "c")
    expect(s.assignments.every((a) => a.personId === "c")).toBe(true)
    expect(s.patterns.map((p) => p.id).sort()).toEqual(["eve", "night"])
    expect(s.members).toEqual([{ personId: "c", teams: ["Cleaning"], managerId: "m" }])
    expect(s.reporting).toEqual({ dueAfterMinutes: 60, teamDefaults: { Cleaning: false }, overrides: { c: true } })
  })
  it("drops other people's overrides", () => {
    expect(ownShiftState(state, "a").reporting.overrides).toEqual({})
    expect(JSON.stringify(ownShiftState(state, "a"))).not.toContain('"b"')
  })
  it("unknown person gets an empty bundle", () => {
    const s = ownShiftState(state, "zz")
    expect(s.patterns).toEqual([])
    expect(s.assignments).toEqual([])
    expect(s.reporting.teamDefaults).toEqual({})
  })
})

describe("edits", () => {
  it("upsert and delete patterns", () => {
    const p: ShiftPattern = { id: "x", name: "X", team: "Security", start: "09:00", end: "17:00", days: [1] }
    const added = upsertPattern(state, p)
    expect(added.patterns).toHaveLength(4)
    const edited = upsertPattern(added, { ...p, name: "Y" })
    expect(edited.patterns.find((q) => q.id === "x")?.name).toBe("Y")
    expect(edited.patterns).toHaveLength(4)
    const gone = deletePattern(state, "night")
    expect(gone.patterns.map((q) => q.id)).toEqual(["day", "eve"])
    expect(gone.assignments.some((a) => a.patternId === "night")).toBe(false)
    expect(nextPatternId([{ ...p, id: "pat-sec-day" }, { ...p, id: "pat-7" }])).toBe("pat-8")
    expect(nextPatternId([])).toBe("pat-1")
  })
  it("assign is idempotent for the same day", () => {
    const s = assign(state, "a", "eve", "2026-10-20")
    expect(s.assignments.at(-1)).toEqual({ personId: "a", patternId: "eve", from: "2026-10-20" })
    expect(assign(state, "a", "day", "2026-10-20")).toBe(state)
  })
  it("unassign ends a running assignment the day before and keeps history", () => {
    const s = unassign(state, "a", "day", "2026-10-20")
    expect(s.assignments.find((x) => x.personId === "a")).toEqual({ personId: "a", patternId: "day", from: "2026-10-01", until: "2026-10-19" })
    expect(shiftsOn("2026-10-20", s.patterns, s.assignments, TZ).some((o) => o.personId === "a")).toBe(false)
    expect(shiftsOn("2026-10-19", s.patterns, s.assignments, TZ).some((o) => o.personId === "a")).toBe(true)
  })
  it("unassign drops future assignments and leaves ended ones", () => {
    const s = unassign(state, "c", "night", "2026-10-20") // night starts 21 Oct
    expect(s.assignments.filter((x) => x.personId === "c")).toEqual([{ personId: "c", patternId: "eve", from: "2026-10-01", until: "2026-10-20" }])
    const t = unassign(state, "c", "eve", "2026-10-25") // already ended
    expect(t.assignments).toEqual(state.assignments)
  })
  it("team default and overrides", () => {
    expect(reportsFor("d", members, setTeamDefault(state, "Cleaning", true).reporting).on).toBe(true)
    expect(setOverride(state, "c", null).reporting.overrides).toEqual({ b: false })
    expect(setOverride(state, "a", false).reporting.overrides.a).toBe(false)
  })
  it("toggle clears the override when it matches the team default", () => {
    expect(toggleReporting(state, "b", true).reporting.overrides).toEqual({ c: true }) // Security default on
    expect(toggleReporting(state, "a", false).reporting.overrides).toEqual({ b: false, c: true, a: false })
    expect(toggleReporting(state, "c", false).reporting.overrides).toEqual({ b: false }) // Cleaning default off
  })
})
