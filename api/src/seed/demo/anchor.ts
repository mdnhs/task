import { addDays, epochToWall, wallToEpoch } from "@opsdesk/domain/shifts"

/** Calendar day of `now` in `tz` (never the server's zone). */
export const todayIn = (now: Date, tz: string): string => epochToWall(now.getTime(), tz).slice(0, 10)

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const isDay = (s: string): boolean => {
  const m = DAY.exec(s)
  return !!m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === s
}
const dayNumber = (d: string): number => Date.parse(`${d}T00:00:00Z`) / 86_400_000

export type Anchor = {
  /** The anchor day itself (the mock's today, moved). */
  today: string
  /** Whole days between the mock's frozen "today" and the anchor day. */
  offsetDays: number
  /** The mock's calendar day moved by the offset. */
  day(mockDay: string): string
  /** A mock wall-clock string (`YYYY-MM-DDTHH:mm[:ss]`) moved by the offset; the local wall time is kept, so DST never shifts it. */
  wall(mockWall: string): string
  /** The UTC instant of the moved wall time in the tenant zone. */
  instant(mockWall: string): Date
}

/**
 * Re-anchors the mock's dates: its frozen `today` (shell/org.json) becomes `anchor` (default: today in the tenant zone), every other date keeps
 * its distance from it. The shift is by calendar days on the wall clock, so 17:00 stays 17:00 local across the October DST end.
 */
export function makeAnchor(o: { mockToday: string; anchor: string; tz: string; offsetDays?: number }): Anchor {
  if (!isDay(o.anchor)) throw new Error("anchor must be a real calendar day YYYY-MM-DD")
  const offsetDays = o.offsetDays ?? dayNumber(o.anchor) - dayNumber(o.mockToday.slice(0, 10))
  const day = (d: string) => addDays(d, offsetDays)
  const wall = (w: string) => `${day(w.slice(0, 10))}${w.slice(10)}`
  return { today: o.anchor, offsetDays, day, wall, instant: (w) => new Date(wallToEpoch(wall(w), o.tz)) }
}

/**
 * The offset for everything with WEEKDAY semantics (shift assignments, report shift dates: a report belongs to a pattern's weekdays). It is a whole number of weeks, so the
 * weekday of every date is kept, and the largest such offset that still leaves the latest mock report (`latestMockDay`) on or before the anchor day: a submitted report is
 * never in the future. Dates without weekday semantics (tasks, subscription dates) keep the exact offset.
 */
export function weekOffset(o: { mockToday: string; anchor: string; latestMockDay: string }): number {
  const room = dayNumber(o.anchor) - dayNumber(o.latestMockDay)
  return 7 * Math.floor(room / 7)
}
