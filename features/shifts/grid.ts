import { WEEKDAY_SHORT, addDays, managerOf, onTeam, reportsFor, shiftsOn, weekDates, weekdayOf } from "@/lib/shifts"
import type { ShiftOccurrence, ShiftState } from "@/lib/shifts"
import type { Person } from "@/lib/types"

// Pure helpers shared by the week view and its skeleton (server loading.tsx), so both count the same rows and chips.

/** People listed on /shifts: those with a reporting line on `team` ("all" = everyone with a line), sorted by name. */
export function rosterPeople(people: Person[], state: ShiftState, team: string): Person[] {
  const lined = new Set(state.members.map((m) => m.personId))
  return people.filter((p) => lined.has(p.id) && onTeam(p.id, state.members, team)).sort((a, b) => a.name.localeCompare(b.name))
}

/** Shifts per person per day of the week starting `start`, keeping only patterns of `team` unless "all". */
export function weekGrid(personIds: string[], state: ShiftState, start: string, tz: string, team: string): Map<string, ShiftOccurrence[][]> {
  const days = weekDates(start).map((d) => shiftsOn(d, state.patterns, state.assignments, tz).filter((o) => team === "all" || o.pattern.team === team))
  return new Map(personIds.map((id) => [id, days.map((list) => list.filter((o) => o.personId === id))]))
}

/** Page subtitle, shared with the skeleton so its ghost text wraps the same way. */
export function shiftsSubtitle(people: Person[], state: ShiftState, scope: "all" | "own", meId: string, team: string): string {
  if (scope === "own") {
    const rep = reportsFor(meId, state.members, state.reporting)
    const mgr = managerOf(meId, state.members)
    const name = mgr ? (people.find((p) => p.id === mgr)?.name ?? "Unknown") : "none"
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
