import { epochToWall, wallToEpoch } from "@opsdesk/domain/shifts"
import { AppError } from "../../core/errors"

/** Tenant-local wall clock `YYYY-MM-DDTHH:mm:ss` of an instant (ruling D3). Offsets are whole minutes, so seconds are the same in every zone. */
export const wallOf = (d: Date, tz: string): string => `${epochToWall(d.getTime(), tz)}:${String(Math.floor(d.getTime() / 1000) % 60).padStart(2, "0")}`

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/** True for a real calendar date and time (no 2026-13-40, no 25:61). */
export function validWall(w: string): boolean {
  const m = WALL.exec(w)
  if (!m) return false
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)))
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && t.getUTCHours() === h && t.getUTCMinutes() === mi && t.getUTCSeconds() === s
}

const MIN = 60_000

/** Offset of `tz` from UTC at instant `ms` (whole minutes: every zone's rule changes on a minute boundary). */
const offsetOf = (ms: number, tz: string): number => Date.parse(`${epochToWall(ms, tz)}:00Z`) - Math.floor(ms / MIN) * MIN

/**
 * Wall clock in the tenant zone → UTC instant (ruling S9, deterministic for every IANA zone). A wall time that happens twice (fall back)
 * takes the FIRST occurrence. One that does not exist (spring forward) moves to the first valid minute after the gap: the minute the offset
 * changes (01:30 in a 01:00-02:00 gap is 02:00, in a 30 minute gap 02:15 is 02:30). 422 invalid_dates for a malformed one.
 */
export function instantOfWall(w: string, tz: string): Date {
  if (!validWall(w)) throw new AppError(422, "invalid_dates", "Unprocessable Entity")
  const ms = wallToEpoch(w, tz)
  if (epochToWall(ms, tz) === w.slice(0, 16)) return new Date(ms) // the wall time exists (the first occurrence when it happens twice)
  // A gap: wallToEpoch read it with the pre-transition offset, which lands inside the new offset. Find the minute the offset changes, within a day before.
  const after = offsetOf(ms, tz)
  let lo = Math.floor(ms / MIN) - 24 * 60 // before the change (a day earlier has the old offset)
  let hi = Math.floor(ms / MIN) // after it
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (offsetOf(mid * MIN, tz) === after) hi = mid
    else lo = mid
  }
  return new Date(hi * MIN)
}
