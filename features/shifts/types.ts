import type { ShiftAssignment, ShiftOccurrence, ShiftPattern, ShiftState } from "@/lib/shifts"
import type { Person } from "@/lib/types"

export type ShiftsTab = "week" | "people" | "patterns"

/** "all" = every member (write roles, manager-home readers); "own" = only the viewer's own shifts (staff-home readers). */
export type ShiftScope = "all" | "own"

/** A pattern as the API holds it: the team's NAME (shown, matched to the report template) and id (sent), and the `version` every edit carries (D4). */
export type ShiftPatternRow = ShiftPattern & { teamId: string; version: number }
/** An assignment with its id (an end or a delete addresses it). */
export type ShiftAssignmentRow = ShiftAssignment & { id: string }
export type ShiftStateRow = Omit<ShiftState, "patterns" | "assignments"> & { patterns: ShiftPatternRow[]; assignments: ShiftAssignmentRow[] }

export type TeamRef = { id: string; name: string }

/** What the /shifts route loads: the API's shift bundle (already cut to the caller: staff get only their own rows), the people and teams it names, and the visible week. */
export type ShiftsData = {
  state: ShiftStateRow
  /** People in the payload: the caller's report scope for "all"; the caller and their manager for "own" (the API's `/v1/people`, not widened here). */
  people: Person[]
  /** Team names (departments map to teams, SRS A.5), the order the API returned them. */
  teams: string[]
  /** The same teams with ids, for writes. */
  teamRefs: TeamRef[]
  scope: ShiftScope
  /** The viewer's user id. */
  meId: string
  /** The week the grid first shows (`GET /v1/shifts/occurrences`, from the stored instants) and its Monday. */
  weekStart: string
  occurrences: ShiftOccurrence[]
}

export const SHIFTS_PAGE_SIZE = 10
