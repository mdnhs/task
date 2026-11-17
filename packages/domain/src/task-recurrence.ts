import type { RepeatRule } from "./task-model"

// FR-TASK-10: recurring tasks. Pure date math on YYYY-MM-DD strings (UTC day numbers, so no DST and no browser timezone).

const DAY = 86_400_000
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const ymd = (iso: string) => iso.slice(0, 10)
const num = (date: string) => {
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10))
  return Math.round(Date.UTC(y, m - 1, d) / DAY)
}
const str = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)

/** Day of week of a YYYY-MM-DD date: 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (date: string) => (((num(date) + 4) % 7) + 7) % 7
export const addDays = (date: string, n: number) => str(num(date) + n)
export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate() // month is 1-based
}

const matches = (rule: RepeatRule, date: string): boolean => {
  if (rule.freq === "per_shift") return false // the occurrences of a shift pattern are computed by the server from the assignments (shifts.ts)
  if (rule.freq === "daily") return true
  const dow = weekdayOf(date)
  if (rule.freq === "weekdays") return dow >= 1 && dow <= 5
  if (rule.freq === "weekly") return (rule.days ?? []).includes(dow)
  // monthly: day N, or the last day of a shorter month (31 -> 30 / 28 / 29)
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10))
  return d === Math.min(rule.dayOfMonth ?? 1, daysInMonth(y, m))
}

/** Occurrence dates (YYYY-MM-DD) strictly after `from` and up to `until`, both inclusive of `until`; the rule's own end date also applies. */
export function nextOccurrences(rule: RepeatRule, from: string, until: string): string[] {
  const start = num(ymd(from)) + 1
  const end = Math.min(num(ymd(until)), rule.until ? num(ymd(rule.until)) : Infinity)
  if (rule.freq === "weekly" && !(rule.days ?? []).length) return []
  const out: string[] = []
  for (let n = start; n <= end && out.length < 1000; n++) {
    const d = str(n)
    if (matches(rule, d)) out.push(d)
  }
  return out
}

/** Short human text for the rule, e.g. "Weekly on Mon, Wed until 30 Nov". */
export function describeRepeat(rule: RepeatRule): string {
  const base =
    rule.freq === "daily" ? "Daily"
    : rule.freq === "weekdays" ? "Every weekday"
    : rule.freq === "per_shift" ? "Every shift"
    : rule.freq === "weekly" ? `Weekly on ${[...(rule.days ?? [])].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).join(", ")}`
    : `Monthly on day ${rule.dayOfMonth ?? 1}`
  return rule.until ? `${base} until ${rule.until}` : base
}

/** Anything wrong with a rule, for form validation. Empty string when fine. */
export function repeatError(rule: RepeatRule, firstDue: string): string {
  if (rule.freq === "per_shift" && !rule.patternId) return "Choose a shift pattern"
  if (rule.freq === "weekly" && !(rule.days ?? []).length) return "Choose at least one day"
  if (rule.freq === "monthly" && !(Number.isInteger(rule.dayOfMonth) && rule.dayOfMonth! >= 1 && rule.dayOfMonth! <= 31)) return "Enter a day from 1 to 31"
  if (rule.until && firstDue && ymd(rule.until) < ymd(firstDue)) return "End date can't be before the first due date"
  return ""
}
