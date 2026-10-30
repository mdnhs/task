import { addDays, weekdayOf } from "./recurrence"
import type { Task } from "./types"

// Calendar view maths (FR-M1-05): weeks start on Monday, dates are YYYY-MM-DD strings. Pure.

/** Monday of the week that holds `date`. */
export const weekStart = (date: string) => addDays(date, -((weekdayOf(date) + 6) % 7))
export const weekOf = (date: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i))

/** Six Monday-first weeks covering the month of `date` (a fixed 6 rows, so the grid never changes height). */
export function monthGrid(date: string): string[][] {
  const first = `${date.slice(0, 7)}-01`
  const start = weekStart(first)
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)))
}

/** The 1st of the month `n` months away from `date`'s month. */
export function shiftMonth(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number)
  const idx = y * 12 + (m - 1) + n
  const yy = Math.floor(idx / 12)
  const mm = (idx % 12) + 1
  return `${yy}-${String(mm).padStart(2, "0")}-01`
}

/** Tasks grouped by due date, earliest due time first. */
export function byDueDay(tasks: readonly Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const t of [...tasks].sort((a, b) => a.due.localeCompare(b.due))) {
    const k = t.due.slice(0, 10)
    const list = map.get(k)
    if (list) list.push(t)
    else map.set(k, [t])
  }
  return map
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const monthLabel = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`
export function weekLabel(date: string): string {
  const [a, b] = [weekOf(date)[0], weekOf(date)[6]]
  const f = (d: string) => `${Number(d.slice(8, 10))} ${SHORT[Number(d.slice(5, 7)) - 1]}`
  return `${f(a)} – ${f(b)} ${b.slice(0, 4)}`
}
