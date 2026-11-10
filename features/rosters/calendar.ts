import { addDays, weekStart } from "@/lib/shifts"
import type { LeaveRequest } from "@/lib/roster-rules"
import type { RosterShift } from "@/lib/rosters"

// Month calendar maths for "My roster" (FR-RS-40). Weeks start on Monday, dates are YYYY-MM-DD strings. Pure.

/** Six Monday-first weeks covering the month of `date` (a fixed 6 rows, so the grid never changes height). */
export function monthGrid(date: string): string[][] {
  const start = weekStart(`${date.slice(0, 7)}-01`)
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)))
}

/** The 1st of the month `n` months away from `date`'s month. */
export function shiftMonth(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number)
  const idx = y * 12 + (m - 1) + n
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
export const monthLabel = (date: string): string => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`

/** Shifts grouped by the day they start (an overnight shift stays on its start day), earliest first. */
export function shiftsByDay(shifts: readonly RosterShift[]): Map<string, RosterShift[]> {
  const map = new Map<string, RosterShift[]>()
  for (const s of [...shifts].sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`))) {
    const list = map.get(s.date)
    if (list) list.push(s)
    else map.set(s.date, [s])
  }
  return map
}

/** The leave (asked or approved, never rejected) that covers `day`, approved first. */
export function leaveOn(day: string, leave: readonly LeaveRequest[]): LeaveRequest | undefined {
  const hit = leave.filter((l) => l.status !== "rejected" && l.from <= day && day <= l.to)
  return hit.find((l) => l.status === "approved") ?? hit[0]
}
