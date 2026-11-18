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

/**
 * Wall clock in the tenant zone → UTC instant (ruling S9, deterministic for every IANA zone). A wall time that happens twice (fall back)
 * takes the FIRST occurrence. One that does not exist (spring forward) moves to the first valid minute after the gap: the minute the offset
 * changes (01:30 in a 01:00-02:00 gap is 02:00, in a 30 minute gap 02:15 is 02:30). 422 invalid_dates for a malformed one.
 */
export function instantOfWall(w: string, tz: string): Date {
  if (!validWall(w)) throw new AppError(422, "invalid_dates", "Unprocessable Entity")
  return new Date(wallToEpoch(w, tz))
}
