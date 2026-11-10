import { getData } from "./data"
import { hasProductModule } from "./entitlements"
import { overlayRoster } from "./roster-overlay"
import type { Location, RosterShift, RosterWeek, ShiftTemplate } from "./rosters"
import { getSession } from "./session"
import type { ReportingSettings, ShiftAssignment, ShiftPattern, ShiftState, TeamMember } from "./shifts"

// Server only (reads the mock JSON in public/data/shifts/). The pure model is lib/shifts.ts, the client store hooks/use-shifts.ts.
// Scope the result with ownShiftState() before sending it to a role that may only see its own shifts.

/** The stored patterns and assignments only, no roster overlay. For the Shifts admin page, which edits patterns and assignments. */
export async function getBaseShiftState(): Promise<ShiftState> {
  const [{ patterns }, { assignments }, { members }, r] = await Promise.all([
    getData<{ patterns: ShiftPattern[] }>("shifts/patterns.json"),
    getData<{ assignments: ShiftAssignment[] }>("shifts/assignments.json"),
    getData<{ members: TeamMember[] }>("shifts/members.json"),
    getData<{ reportDueAfterMinutes: number; teamDefaults: ReportingSettings["teamDefaults"]; overrides: ReportingSettings["overrides"] }>("shifts/reporting.json"),
  ])
  return { patterns, assignments, members, reporting: { dueAfterMinutes: r.reportDueAfterMinutes, teamDefaults: r.teamDefaults, overrides: r.overrides } }
}

/**
 * What shift reports, Today and the other consumers read (D3): the stored state plus the published roster shifts as one-day patterns, when the
 * tenant has Location Rosters (product module M1A). Without it the result equals getBaseShiftState().
 */
export async function getShiftState(): Promise<ShiftState> {
  const [base, session] = await Promise.all([getBaseShiftState(), getSession()])
  if (!hasProductModule(session.entitlements, "M1A")) return base
  const [{ weeks }, { shifts }, { templates }, { locations }] = await Promise.all([
    getData<{ weeks: RosterWeek[] }>("rosters/weeks.json"),
    getData<{ shifts: RosterShift[] }>("rosters/shifts.json"),
    getData<{ templates: ShiftTemplate[] }>("rosters/templates.json"),
    getData<{ locations: Location[] }>("rosters/locations.json"),
  ])
  return overlayRoster(base, weeks, shifts, templates, locations)
}
