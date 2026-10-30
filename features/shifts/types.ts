import type { ShiftState } from "@/lib/shifts"
import type { Person } from "@/lib/types"

export type ShiftsTab = "week" | "people" | "patterns"

/** "all" = every member (write roles, manager-home readers); "own" = only the viewer's own shifts (staff-home readers). */
export type ShiftScope = "all" | "own"

/** What the /shifts route loads: the scoped shift bundle, the people it names, and the tenant's teams. */
export type ShiftsData = {
  state: ShiftState
  /** People in the payload: everyone for "all"; the viewer and their primary manager for "own". */
  people: Person[]
  /** Team names (departments map to teams, SRS A.5); for "own" only the viewer's teams. */
  teams: string[]
  scope: ShiftScope
  /** The viewer's person id (mock "me" for staff-home roles). */
  meId: string
}

export const SHIFTS_PAGE_SIZE = 10
