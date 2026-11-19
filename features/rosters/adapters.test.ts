import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import {
  toChangeRequest, toExchange, toHistory, toLeave, toLocation, toMine, toRepeat, toRules, toShift, toShiftType, toViolation, toWeek, toWeeksPayload,
} from "./adapters"
import { changeRequestDto, exchangeDto, historyDto, leaveDto, locationDto, mineShiftDto, rulesDto, shiftDto, shiftTypeDto, violationDto, weekDto, weeksDto, LID, SHIFT_ID, STID, UID, WEEK_ID } from "./fixtures"

describe("adapters: a week DTO becomes RosterWeek and RosterShift (R8-2)", () => {
  test("adapters map a week DTO to RosterWeek and RosterShift with wall strings and instants (R8-2) and never invent a location name", () => {
    const p = toWeeksPayload(weeksDto, [locationDto])
    const s = p.shifts[0]!
    // wall strings stay the location's clock, the instants stay UTC: nothing is converted or recomputed
    expect([s.date, s.start, s.end, s.startAt, s.endAt]).toEqual(["2026-11-02", "22:00", "06:00", "2026-11-02T22:00:00.000Z", "2026-11-03T06:00:00.000Z"])
    // the domain shape: personId and templateId, so the pure functions of @opsdesk/domain keep working
    expect([s.personId, s.templateId, s.weekId, s.locationId, s.version]).toEqual([UID, STID, WEEK_ID, LID, 1])
    const w = p.weeks[0]!
    expect([w.weekStart, w.status, w.version, w.days[0]!.short]).toEqual(["2026-11-02", "draft", 1, 1])
    expect(p.shiftTypes[0]).toMatchObject({ id: STID, name: "Night", requires: ["SIA licence"], targets: [{ weekday: 1, count: 2 }] })
    expect(p.members[0]).toEqual({ id: UID, name: "Aoife Byrne", active: true, homeLocationId: LID })
    // a location the caller cannot see is simply absent: no name is made up for a shift that points at it
    const other = toWeeksPayload({ ...weeksDto, shifts: [{ ...shiftDto, locationId: "11111111-1111-4111-8111-111111111111" }] }, [locationDto])
    expect(other.locations.map((l) => l.name)).toEqual(["Harbour Street"])
    expect(JSON.stringify(other)).not.toMatch(/Unknown|Location\b/)
    expect(toLocation({ ...locationDto, lat: null, lng: null, timeZone: null })).toMatchObject({ lat: null, lng: null, timeZone: null })
  })

  test("a null user stays an open shift (personId null)", () => {
    expect(toShift({ ...shiftDto, userId: null }).personId).toBeNull()
  })

  test("adapters keep unknown future fields out of components (a stray field is dropped, not thrown)", () => {
    const s = toShift({ ...shiftDto, futureField: "x", nested: { a: 1 } }) as Record<string, unknown>
    expect(s.futureField).toBeUndefined()
    expect(s.nested).toBeUndefined()
    expect(Object.keys(toWeek({ ...weekDto, extra: 1 }) as object)).not.toContain("extra")
    expect(Object.keys(toLocation({ ...locationDto, extra: 1 }))).not.toContain("extra")
    expect(Object.keys(toExchange({ ...exchangeDto, extra: 1 }))).not.toContain("extra")
    expect(Object.keys(toViolation({ ...violationDto, extra: 1 }))).not.toContain("extra")
  })

  test("a missing or mistyped required field throws (a renamed field must not become a silent empty value)", () => {
    expect(() => toShift({ ...shiftDto, startAt: undefined })).toThrow(/startAt/)
    expect(() => toShift({ ...shiftDto, version: "1" })).toThrow(/version/)
    expect(() => toLocation({ ...locationDto, name: 5 })).toThrow(/name/)
    expect(() => toMine({ from: "a", to: "b", items: [{ ...mineShiftDto, locationName: undefined }], truncated: false })).toThrow(/locationName/)
    expect(() => toWeek({ ...weekDto, status: "archived" })).toThrow(/status/)
  })

  test("the other DTOs map one to one", () => {
    expect(toShiftType(shiftTypeDto)).toMatchObject({ locationId: LID, unpaidBreakMin: 30, archived: false, version: 1 })
    expect(toViolation(violationDto)).toEqual({ rule: "daily_rest", shiftId: SHIFT_ID, personId: UID, severity: "warn", message: violationDto.message, otherShiftIds: [] })
    expect(toLeave(leaveDto)).toMatchObject({ personId: UID, status: "requested", note: "Family trip" })
    expect(toExchange(exchangeDto)).toMatchObject({ kind: "claim", fromUserId: UID, toUserId: null, expired: false })
    expect(toChangeRequest(changeRequestDto)).toMatchObject({ requestedBy: UID, shiftVersion: 2, patch: { start: "09:00", end: "17:00" } })
    expect(toHistory(historyDto)).toMatchObject({ by: UID, action: "shift_moved", shiftId: SHIFT_ID, before: { start: "08:00" } })
    expect(toRules(rulesDto, '"abc"')).toEqual({ severity: rulesDto.severity, avgWeekReferenceWeeks: 17, draftWarnDays: 3, etag: '"abc"' })
    const m = toMine({ from: "2026-11-16", to: "2026-12-13", items: [mineShiftDto], truncated: false })
    expect(m.shifts[0]).toMatchObject({ locationName: "Harbour Street", timeZone: "Europe/Dublin", startAt: "2026-11-16T08:00:00.000Z" })
    const r = toRepeat({ created: [weekDto], conflicts: [{ weekId: WEEK_ID, shiftId: SHIFT_ID, personId: UID, date: "2026-11-10", reason: "approved_leave", open: true, message: "m" }], counts: { copied: 1, kept: 0, warned: 0, opened: 1 } })
    expect(r.created[0]!.id).toBe(WEEK_ID)
    expect(r.conflicts[0]!.open).toBe(true)
  })

  test("getRosterData path: no rule engine in the web payload path (grep test)", () => {
    for (const f of ["adapters.ts", "loaders.ts", "readers.ts"]) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8")
      // only type imports of roster-rules are allowed; checkShifts and friends are the server's job (R8: the rule engine runs on the API)
      expect(src, f).not.toMatch(/^import\s+(?!type\b)[^\n]*roster-rules/m)
      expect(src, f).not.toMatch(/checkShifts|checkAssign|domain\/roster-rules/)
    }
  })
})
