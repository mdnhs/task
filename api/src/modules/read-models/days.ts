import { addDays, epochToWall, wallToEpoch } from "@opsdesk/domain/shifts"

// Tenant-local days (ruling D3): a day is [localMidnight(d), localMidnight(d+1)) as UTC instants, so a DST day is 23 or 25 hours long (25 Oct 2026 and 28 Mar 2027 in Europe/Dublin). Never UTC.

/** The tenant-local calendar day (YYYY-MM-DD) of an instant. */
export const localDay = (at: Date, tz: string): string => epochToWall(at.getTime(), tz).slice(0, 10)

/** The instants a local day covers: `start` inclusive, `end` exclusive (epoch ms). */
export function dayBounds(day: string, tz: string): { start: number; end: number } {
  return { start: wallToEpoch(`${day}T00:00:00`, tz), end: wallToEpoch(`${addDays(day, 1)}T00:00:00`, tz) }
}

/** `n` consecutive days ending at `end` (inclusive), oldest first. */
export const lastDays = (end: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)))
