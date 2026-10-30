import { getData } from "./data"
import type { ReportingSettings, ShiftAssignment, ShiftPattern, ShiftState, TeamMember } from "./shifts"

// Server only (reads the mock JSON in public/data/shifts/). The pure model is lib/shifts.ts, the client store hooks/use-shifts.ts.
// Scope the result with ownShiftState() before sending it to a role that may only see its own shifts.
export async function getShiftState(): Promise<ShiftState> {
  const [{ patterns }, { assignments }, { members }, r] = await Promise.all([
    getData<{ patterns: ShiftPattern[] }>("shifts/patterns.json"),
    getData<{ assignments: ShiftAssignment[] }>("shifts/assignments.json"),
    getData<{ members: TeamMember[] }>("shifts/members.json"),
    getData<{ reportDueAfterMinutes: number; teamDefaults: ReportingSettings["teamDefaults"]; overrides: ReportingSettings["overrides"] }>("shifts/reporting.json"),
  ])
  return { patterns, assignments, members, reporting: { dueAfterMinutes: r.reportDueAfterMinutes, teamDefaults: r.teamDefaults, overrides: r.overrides } }
}
