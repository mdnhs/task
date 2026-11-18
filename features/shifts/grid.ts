import { WEEKDAY_SHORT, addDays, managerOf, onTeam, reportsFor, weekDates, weekdayOf } from "@/lib/shifts"
import type { ShiftOccurrence, ShiftState } from "@/lib/shifts"
import type { Person } from "@/lib/types"

// Pure helpers shared by the week view and its skeleton (server loading.tsx), so both count the same rows and chips.

/** People listed on /shifts: those with a reporting line on `team` ("all" = everyone with a line), sorted by name. */
export function rosterPeople(people: Person[], state: ShiftState, team: string): Person[] {
  const lined = new Set(state.members.map((m) => m.personId))
  return people.filter((p) => lined.has(p.id) && onTeam(p.id, state.members, team)).sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Shifts per person per day of the week starting `start`, from the API's OCCURRENCES (stored instants; a shift belongs to its START date), keeping only patterns of `team` unless "all".
 * Nothing here recomputes a shift from a pattern, so a night over the DST fold or gap shows the hours the API stored.
 */
export function weekGridFrom(personIds: string[], occurrences: ShiftOccurrence[], start: string, team: string): Map<string, ShiftOccurrence[][]> {
  const dates = weekDates(start)
  const grid = new Map<string, ShiftOccurrence[][]>(personIds.map((id) => [id, dates.map(() => [])]))
  for (const o of occurrences) {
    const row = grid.get(o.personId)
    const day = dates.indexOf(o.window.date)
    if (!row || day < 0 || (team !== "all" && o.pattern.team !== team)) continue
    row[day]!.push(o)
  }
  for (const row of grid.values()) for (const day of row) day.sort((a, b) => a.window.start.localeCompare(b.window.start))
  return grid
}

/** Page subtitle, shared with the skeleton so its ghost text wraps the same way. */
export function shiftsSubtitle(people: Person[], state: ShiftState, scope: "all" | "own", meId: string, team: string): string {
  if (scope === "own") {
    const rep = reportsFor(meId, state.members, state.reporting)
    const mgr = managerOf(meId, state.members)
    const name = mgr ? (people.find((p) => p.id === mgr)?.name ?? "Your manager") : "none"
    return `Your shifts · Manager: ${name} · Shift reporting ${rep.on ? "on" : "off"}`
  }
  const n = rosterPeople(people, state, team).length
  const pats = state.patterns.filter((p) => team === "all" || p.team === team).length
  return `${n} people · ${pats} patterns · Reports due ${state.reporting.dueAfterMinutes} min after shift end`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const dm = (d: string) => ({ d: parseInt(d.slice(8, 10), 10), m: MONTHS[parseInt(d.slice(5, 7), 10) - 1] })

/** "Mon 19": week grid header and phone label for a date. */
export const dayLabel = (date: string) => `${WEEKDAY_SHORT[weekdayOf(date)]} ${dm(date).d}`

/** "19–25 Oct" or "26 Oct – 1 Nov" for the week starting `start`. */
export function weekLabel(start: string) {
  const a = dm(start)
  const b = dm(addDays(start, 6))
  return a.m === b.m ? `${a.d}–${b.d} ${a.m}` : `${a.d} ${a.m} – ${b.d} ${b.m}`
}
