/**
 * Quiet hours, computed in the TENANT's timezone with Intl only (no date library).
 *
 * quietWindow(prefs, tz, now) -> { quiet, endsAt }
 *  - prefs.quietStart / quietEnd are local wall-clock "HH:MM". null, or start == end, means no window.
 *  - The window is [start, end): start inclusive, end exclusive. If start > end it spans midnight.
 *  - quiet === false  -> endsAt is `now`.   quiet === true -> endsAt is the instant the window ends (the next local `end`).
 *
 * Algorithm
 *  1. wallClock(tz, instant): format the instant with Intl.DateTimeFormat in `tz` (hourCycle h23) and read the local
 *     y/m/d/h/min. This follows the tz database, so it is correct on both sides of a DST change.
 *  2. offsetMs(tz, instant) = (local wall-clock read as if it were UTC) - instant. The UTC offset in force at that instant.
 *  3. wallToInstant(tz, y, m, d, h, min): the inverse. guess = Date.UTC(wall); t = guess - offset(guess); then re-measure
 *     the offset at t and, if it differs (we crossed a DST boundary), use that one: t = guess - offset(t). A wall time
 *     that does not exist (spring-forward gap) lands just after the gap; one that occurs twice (autumn overlap) resolves
 *     to one of the two instants; both are acceptable for a "hold until about 07:00" use.
 *  4. Compare minutes-since-local-midnight of `now` with start/end to decide `quiet`. endsAt is built from the LOCAL
 *     calendar date (today, or tomorrow when the window spans midnight and we are before midnight) at `end`, via
 *     wallToInstant, so it is always 07:00 local even if the night is 23 or 25 hours long.
 *  5. Guarantee: endsAt > now and the instant endsAt is not quiet. If the end wall time falls in a DST gap, or the
 *     instant it resolved to is still inside the window, step forward in minutes to the first non-quiet instant.
 */
export type QuietPrefs = { quietStart: string | null; quietEnd: string | null }

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
export const isHHMM = (v: string): boolean => HHMM.test(v)
const minutesOf = (v: string): number => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5))

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    formatters.set(tz, f)
  }
  return f
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number }

function wallClock(tz: string, at: Date): Wall & { s: number } {
  const p: Record<string, number> = {}
  for (const part of formatter(tz).formatToParts(at)) if (part.type !== "literal") p[part.type] = Number(part.value)
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second }
}

function offsetMs(tz: string, at: Date): number {
  const w = wallClock(tz, at)
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(at.getTime() / 1000) * 1000
}

function wallToInstant(tz: string, w: Wall): Date {
  const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, 0)
  const first = guess - offsetMs(tz, new Date(guess))
  const second = guess - offsetMs(tz, new Date(first))
  return new Date(second)
}

function inWindow(tz: string, at: Date, start: number, end: number): boolean {
  const w = wallClock(tz, at)
  const cur = w.h * 60 + w.mi
  return start > end ? cur >= start || cur < end : cur >= start && cur < end
}

export function quietWindow(prefs: QuietPrefs, tz: string, now: Date): { quiet: boolean; endsAt: Date } {
  const { quietStart, quietEnd } = prefs
  if (!quietStart || !quietEnd || quietStart === quietEnd || !isHHMM(quietStart.slice(0, 5)) || !isHHMM(quietEnd.slice(0, 5))) return { quiet: false, endsAt: now }
  const start = minutesOf(quietStart)
  const end = minutesOf(quietEnd)
  const w = wallClock(tz, now)
  const cur = w.h * 60 + w.mi
  const spans = start > end
  const quiet = inWindow(tz, now, start, end)
  if (!quiet) return { quiet: false, endsAt: now }
  const nextDay = spans && cur >= start // before midnight inside a midnight-spanning window: the end is tomorrow
  const day = new Date(Date.UTC(w.y, w.mo - 1, w.d + (nextDay ? 1 : 0)))
  let endsAt = wallToInstant(tz, { y: day.getUTCFullYear(), mo: day.getUTCMonth() + 1, d: day.getUTCDate(), h: Math.floor(end / 60), mi: end % 60 })
  // A DST gap (or an overlap resolved to its earlier pass) can leave the computed end at or before now, or still inside
  // the window. Guarantee endsAt > now and not quiet there: step forward minute by minute (bounded, 26 h).
  let t = Math.max(endsAt.getTime(), now.getTime() + 1000)
  for (let i = 0; i < 26 * 60 && inWindow(tz, new Date(t), start, end); i++) t += 60_000
  if (t !== endsAt.getTime()) endsAt = new Date(t)
  return { quiet: true, endsAt }
}
