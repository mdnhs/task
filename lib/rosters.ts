import { addDays, crossesMidnight, minutesBetween, weekDates, weekStart, weekdayOf, type Weekday } from "./shifts"

// Roster model (Module 1A). Pure: types and the maths every roster screen shares. A shift stays on the date it starts (FR-RS-21),
// even when it ends the next morning. Times are wall clock in the tenant zone; durations are real time, so a clock change counts.

export type Location = { id: string; name: string; address: string; pin: { lat: number; lng: number }; zoneRadiusM: number; openingHours: string; contact: string; swapApprovalDelegated: boolean }
export type ShiftTemplate = { id: string; locationId: string; name: string; start: string; end: string; unpaidBreakMin: number; role: string; requires: string[] }
export type StaffingTarget = { locationId: string; templateId: string; weekday: Weekday; count: number }
export type RosterWeek = { id: string; locationId: string; weekStart: string; status: "draft" | "published"; publishedAt: string | null; publishedBy: string | null; autoRepeatDays: number | null }
export type RosterShift = { id: string; weekId: string; locationId: string; date: string; personId: string | null; templateId: string; role: string; start: string; end: string; unpaidBreakMin: number; confirmedAt: string | null }
export type HistoryEntry = { id: string; weekId: string | null; locationId: string; shiftId: string | null; at: string; by: string; action: string; before: unknown; after: unknown; reason: string | null }
export type DayColumn = { date: string; shifts: RosterShift[]; count: number; target: number; short: number; over: number }

/** Seven columns for the week. `count` is assigned shifts only (open shifts don't count); `target` sums the location's targets for that weekday. */
export function dayColumns(week: RosterWeek, shifts: RosterShift[], targets: StaffingTarget[], templates: ShiftTemplate[]): DayColumn[] {
  const known = new Set(templates.filter((t) => t.locationId === week.locationId).map((t) => t.id))
  return weekDates(week.weekStart).map((date) => {
    const day = shifts.filter((s) => s.date === date && s.weekId === week.id)
    const weekday = weekdayOf(date)
    const target = targets.filter((t) => t.locationId === week.locationId && t.weekday === weekday && known.has(t.templateId)).reduce((n, t) => n + t.count, 0)
    const count = day.filter((s) => s.personId !== null).length
    return { date, shifts: day, count, target, short: Math.max(0, target - count), over: Math.max(0, count - target) }
  })
}

/** End as a wall clock "YYYY-MM-DDTHH:MM": the next day when the shift runs past midnight. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- tz kept for a uniform signature with shiftMinutes
export function shiftEnd(s: Pick<RosterShift, "date" | "start" | "end">, _tz: string): string {
  return `${crossesMidnight(s) ? addDays(s.date, 1) : s.date}T${s.end}`
}

/** Paid minutes: real elapsed time (DST-aware) minus the unpaid break. */
export function shiftMinutes(s: Pick<RosterShift, "date" | "start" | "end" | "unpaidBreakMin">, tz: string): number {
  return Math.max(0, minutesBetween(`${s.date}T${s.start}`, shiftEnd(s, tz), tz) - s.unpaidBreakMin)
}

/** Inclusive date range for a view. Day, Monday-based week and fortnight, calendar month. */
export function rosterRange(view: "day" | "week" | "fortnight" | "month", anchor: string): { from: string; to: string } {
  const day = anchor.slice(0, 10)
  if (view === "day") return { from: day, to: day }
  if (view === "week") { const from = weekStart(day); return { from, to: addDays(from, 6) } }
  if (view === "fortnight") { const from = weekStart(day); return { from, to: addDays(from, 13) } }
  const from = `${day.slice(0, 8)}01`
  const next = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7), 1)).toISOString().slice(0, 10)
  return { from, to: addDays(next, -1) }
}
