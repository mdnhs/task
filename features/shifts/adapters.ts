// Pure mappers between the shifts API's DTOs and the UI's shift model (B6 T6.7). Ids (I11): the team's NAME is for display and for matching the report template, its id for writes.
// Times (I12, F2, F3): a shift belongs to its START date in the pattern's zone (`shiftDate`); the window's walls are derived from the stored INSTANTS in the tenant's zone, so a night that
// crosses the DST fold (25 Oct 2026) or gap (28 Mar 2027) shows its real hours, and the API's own wall strings are never used for display. A missing or extra field throws.
import { reader } from "@/lib/api/read"
import { wallInTz } from "@/lib/tz"
import type { ShiftOccurrence, Weekday } from "@/lib/shifts"
import type { ShiftAssignmentRow, ShiftPatternRow, ShiftStateRow, TeamRef } from "./types"

const R = reader("shifts")
const wall = (instant: string, tz: string): string => wallInTz(instant, tz).slice(0, 16)

function toPattern(v: unknown, name: (id: string) => string): ShiftPatternRow {
  const r = R.rec(v, "pattern")
  R.exact(r, ["id", "name", "teamId", "start", "end", "days", "timeZone", "version"])
  const zone = R.strOrNull(r, "timeZone")
  const teamId = R.str(r, "teamId")
  return {
    id: R.str(r, "id"),
    name: R.str(r, "name"),
    team: name(teamId),
    teamId,
    start: R.str(r, "start"),
    end: R.str(r, "end"),
    days: R.arr(r, "days").map((d) => (Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6 ? (d as Weekday) : (R.rec(null, "day") as never))),
    ...(zone ? { timeZone: zone } : {}),
    version: R.int(r, "version"),
  }
}

/** `GET /v1/shifts` as the UI's shift state. `teams` names the team ids (`GET /v1/teams`); an id it does not know reads as "" (never undefined). */
export function toShiftState(dto: unknown, teams: TeamRef[]): ShiftStateRow {
  const r = R.rec(dto, "shifts")
  R.exact(r, ["patterns", "assignments", "members", "reporting"])
  const name = (id: string) => teams.find((t) => t.id === id)?.name ?? ""
  const reporting = R.rec(r.reporting, "reporting")
  R.exact(reporting, ["dueAfterMinutes", "teamDefaults", "overrides"])
  const teamDefaults: Record<string, boolean> = {}
  for (const [id, on] of Object.entries(R.rec(reporting.teamDefaults, "teamDefaults"))) teamDefaults[name(id)] = on === true
  const overrides: Record<string, boolean> = {}
  for (const [id, on] of Object.entries(R.rec(reporting.overrides, "overrides"))) overrides[id] = on === true
  return {
    patterns: R.arr(r, "patterns").map((p) => toPattern(p, name)),
    assignments: R.arr(r, "assignments").map((a): ShiftAssignmentRow => {
      const x = R.rec(a, "assignment")
      R.exact(x, ["id", "userId", "patternId", "from", "until"])
      const until = R.strOrNull(x, "until")
      return { id: R.str(x, "id"), personId: R.str(x, "userId"), patternId: R.str(x, "patternId"), from: R.str(x, "from"), ...(until ? { until } : {}) }
    }),
    members: R.arr(r, "members").map((m) => {
      const x = R.rec(m, "member")
      R.exact(x, ["userId", "teams", "managerId"])
      return { personId: R.str(x, "userId"), teams: R.arr(x, "teams").map((t) => name(typeof t === "string" ? t : "")), managerId: R.strOrNull(x, "managerId") }
    }),
    reporting: { dueAfterMinutes: R.int(reporting, "dueAfterMinutes"), teamDefaults, overrides },
  }
}

/** `GET /v1/shifts/occurrences`: shifts that START in the range, each with the pattern it belongs to (built from the occurrence when the state has no such pattern). */
export function toOccurrences(dto: unknown, state: Pick<ShiftStateRow, "patterns">, tz: string): ShiftOccurrence[] {
  const r = R.rec(dto, "occurrences")
  return R.arr(r, "items").map((v) => {
    const x = R.rec(v, "occurrence")
    R.exact(x, ["userId", "patternId", "name", "teamId", "shiftDate", "start", "end", "startAt", "endAt", "minutes", "endsNextDay", "reportsOn"])
    const startAt = R.str(x, "startAt")
    const endAt = R.str(x, "endAt")
    const start = wall(startAt, tz)
    const end = wall(endAt, tz)
    R.str(x, "start")
    R.str(x, "end")
    const patternId = R.str(x, "patternId")
    const pattern =
      state.patterns.find((p) => p.id === patternId) ??
      ({ id: patternId, name: R.str(x, "name"), team: "", teamId: R.str(x, "teamId"), start: start.slice(11), end: end.slice(11), days: [], version: 0 } satisfies ShiftPatternRow)
    return {
      personId: R.str(x, "userId"),
      pattern,
      window: { patternId, date: R.str(x, "shiftDate"), start, end, timeZone: tz, endsNextDay: end.slice(0, 10) > start.slice(0, 10), minutes: R.int(x, "minutes") },
    }
  })
}
