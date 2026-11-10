import { getOrg } from "@/lib/org"
import { getPeople } from "@/lib/people"
import { managerOf, ownShiftState } from "@/lib/shifts"
import { getBaseShiftState, getShiftState } from "@/lib/shifts-data"
import type { ShiftScope, ShiftsData } from "./types"

// Server only. "all" is the admin view (patterns and assignments are edited): it reads the BASE state, so roster overlay patterns (D3) never show as
// editable. "own" is read-only, so it reads the overlaid state and a person sees their roster shifts with their own times. For "own" the bundle is cut here (ownShiftState), so other people's shifts, overrides and lines never
// reach the client payload; the only other person sent is the viewer's primary manager (name for the "Manager" field).
export async function getShifts(scope: ShiftScope, meId: string): Promise<ShiftsData> {
  const [all, people, org] = await Promise.all([scope === "all" ? getBaseShiftState() : getShiftState(), getPeople(), getOrg()])
  if (scope === "all") return { state: all, people, teams: org.departments, scope, meId }
  const state = ownShiftState(all, meId)
  const keep = new Set([meId, managerOf(meId, all.members)])
  const teams = org.departments.filter((t) => state.members.some((m) => m.teams.includes(t)))
  return { state, people: people.filter((p) => keep.has(p.id)), teams, scope, meId }
}
