import { describe, expect, test } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { ApiError } from "@/lib/api/problem"
import { MGR, ME, PID, TEAM, TZ, occurrenceDto, shiftsDto } from "@/test/support/report-dto"
import { toOccurrences, toShiftState } from "./adapters"
import { makeShiftsClient, shiftsMessage } from "./client"

const TEAMS = [{ id: TEAM, name: "Security" }]

describe("toShiftState", () => {
  test("patterns carry the team NAME, the team id and the version; assignments their id; reporting is keyed by team name and user", () => {
    const s = toShiftState(shiftsDto(), TEAMS)
    expect(s.patterns).toEqual([{ id: PID, name: "Night", team: "Security", teamId: TEAM, start: "22:00", end: "06:00", days: [0, 1, 2, 3, 4, 5, 6], version: 3 }])
    expect(s.assignments[0]).toMatchObject({ id: expect.any(String), personId: ME, patternId: PID, from: "2026-10-01" })
    expect(s.assignments[0]!.until).toBeUndefined()
    expect(s.members).toEqual([{ personId: ME, teams: ["Security"], managerId: MGR }])
    expect(s.reporting).toEqual({ dueAfterMinutes: 60, teamDefaults: { Security: true }, overrides: { [ME]: false } })
    expect(JSON.stringify(s)).not.toContain("undefined")
  })
  test("a pattern with its own zone keeps it; a team the list does not know reads as an empty name, never undefined", () => {
    const d = shiftsDto() as { patterns: Record<string, unknown>[] }
    d.patterns[0] = { ...d.patterns[0]!, timeZone: "America/New_York" }
    expect(toShiftState(d, TEAMS).patterns[0]!.timeZone).toBe("America/New_York")
    expect(toShiftState(shiftsDto(), []).patterns[0]!.team).toBe("")
  })
  test("a missing or extra field throws", () => {
    const d = shiftsDto() as Record<string, unknown>
    delete d.reporting
    expect(() => toShiftState(d, TEAMS)).toThrow()
    expect(() => toShiftState({ ...shiftsDto(), extra: 1 }, TEAMS)).toThrow()
  })
  test("a staff member's own cut maps the same way (the API sent only their rows; nothing is re-scoped here)", () => {
    const d = shiftsDto()
    d.members = [{ userId: ME, teams: [TEAM], managerId: MGR }]
    expect(toShiftState(d, TEAMS).members).toHaveLength(1)
  })
})

describe("occurrences come from the stored instants", () => {
  const state = toShiftState(shiftsDto(), TEAMS)
  test("the 24 Oct night over the DST fold: 22:00 to 06:00, ends the next day, nine real hours", () => {
    const [o] = toOccurrences({ items: [occurrenceDto()] }, state, TZ)
    expect(o!.window).toMatchObject({ date: "2026-10-24", start: "2026-10-24T22:00", end: "2026-10-25T06:00", endsNextDay: true, minutes: 540, timeZone: TZ })
    expect(o!.pattern.name).toBe("Night")
    expect(o!.personId).toBe(ME)
  })
  test("the wall times are derived from startAt and endAt in the tenant zone, not taken from the DTO's strings", () => {
    const [o] = toOccurrences({ items: [occurrenceDto({ start: "2026-10-24T21:00", end: "2026-10-25T05:00" })] }, state, TZ)
    expect([o!.window.start, o!.window.end]).toEqual(["2026-10-24T22:00", "2026-10-25T06:00"])
  })
  test("the 27 Mar 2027 night (gap) is seven real hours", () => {
    const [o] = toOccurrences({ items: [occurrenceDto({ shiftDate: "2027-03-27", startAt: "2027-03-27T22:00:00.000Z", endAt: "2027-03-28T05:00:00.000Z", minutes: 420 })] }, state, TZ)
    expect(o!.window).toMatchObject({ start: "2027-03-27T22:00", end: "2027-03-28T06:00", minutes: 420, endsNextDay: true })
  })
  test("a shift on a Pacific/Auckland tenant shows Auckland times", () => {
    const [o] = toOccurrences({ items: [occurrenceDto()] }, state, "Pacific/Auckland")
    expect(o!.window.start).toBe("2026-10-25T10:00")
  })
  test("an occurrence of a pattern the state does not hold still maps (the pattern is built from the occurrence)", () => {
    const [o] = toOccurrences({ items: [occurrenceDto({ patternId: "8d1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8", name: "Late" })] }, state, TZ)
    expect(o!.pattern.name).toBe("Late")
  })
})

describe("shift writes send the version and the right ids", () => {
  const pattern = { id: PID, name: "Night", team: "Security", teamId: TEAM, start: "22:00", end: "06:00", days: [1, 2], version: 3 }
  const body = { name: "Early", team: "Security", start: "06:00", end: "14:00", days: [1, 2, 3] as (0 | 1 | 2 | 3 | 4 | 5 | 6)[] }
  test("create sends the team id (not the name); edit sends the version; delete archives", async () => {
    const api = fakeApi({
      "POST /v1/shifts/patterns": shiftsDto().patterns[0],
      "PATCH /v1/shifts/patterns/{id}": shiftsDto().patterns[0],
      "DELETE /v1/shifts/patterns/{id}": undefined,
    })
    const c = makeShiftsClient(api.client, TEAMS)
    await c.createPattern(body)
    expect(api.calls[0]!.body).toEqual({ name: "Early", teamId: TEAM, start: "06:00", end: "14:00", days: [1, 2, 3] })
    await c.updatePattern(pattern, body)
    expect(api.calls[1]).toMatchObject({ path: "/v1/shifts/patterns/{id}", body: { version: 3, name: "Early", teamId: TEAM, start: "06:00", end: "14:00", days: [1, 2, 3] } })
    await c.archivePattern(pattern)
    expect(api.paths()[2]).toBe("DELETE /v1/shifts/patterns/{id}")
  })
  test("a pattern edit without a version throws before any request; an unknown team throws", async () => {
    const api = fakeApi({})
    const c = makeShiftsClient(api.client, TEAMS)
    await expect(c.updatePattern({ ...pattern, version: undefined as never }, body)).rejects.toThrow(/version/)
    await expect(c.createPattern({ ...body, team: "Nope" })).rejects.toThrow(/team/)
    expect(api.calls).toEqual([])
  })
  test("assignments: create, end (until) and delete; reporting on or off per team and per member, null follows the team", async () => {
    const api = fakeApi({
      "POST /v1/shifts/assignments": shiftsDto().assignments[0],
      "PATCH /v1/shifts/assignments/{id}": shiftsDto().assignments[0],
      "DELETE /v1/shifts/assignments/{id}": undefined,
      "PUT /v1/shifts/reporting/teams/{teamId}": { teamId: TEAM, on: true },
      "PUT /v1/shifts/reporting/people/{userId}": { userId: ME, on: null },
    })
    const c = makeShiftsClient(api.client, TEAMS)
    await c.assign(ME, PID, "2026-11-01")
    expect(api.calls[0]!.body).toEqual({ userId: ME, patternId: PID, from: "2026-11-01" })
    await c.endAssignment("a1", "2026-11-30")
    expect(api.calls[1]).toMatchObject({ body: { until: "2026-11-30" } })
    await c.deleteAssignment("a1")
    await c.setTeamReporting("Security", true)
    expect(api.calls[3]).toMatchObject({ path: "/v1/shifts/reporting/teams/{teamId}", body: { on: true } })
    await c.setPersonReporting(ME, null)
    expect(api.calls[4]).toMatchObject({ body: { on: null } })
  })
  test("a team-scope manager's 403 reads 'All-scope managers only'; other refusals keep their own copy", () => {
    expect(shiftsMessage(new ApiError(403, "forbidden", "r1")).text).toBe("All-scope managers only.")
    expect(shiftsMessage(new ApiError(409, "pattern_name_taken", "r1")).text).toMatch(/name/i)
    expect(shiftsMessage(new ApiError(422, "invalid_assignment", "r1")).text).toMatch(/assignment/i)
    expect(shiftsMessage(new ApiError(409, "version_conflict", "r1")).text).toBeTruthy()
    void problem
  })
})
