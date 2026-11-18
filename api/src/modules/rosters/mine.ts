import { and, asc, between, eq } from "drizzle-orm"
import { buildIcs } from "@opsdesk/domain/ics"
import { addDays } from "@opsdesk/domain/shifts"
import { AppError } from "../../core/errors"
import { locations, rosterShifts, rosterWeeks, shiftTypes } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { MineDto } from "./dto-reads"
import { realDate, todayOf } from "./qualifications"
import type { RosterCtx } from "./scope"

// My roster (B8 Task 14; FR-RS-33, 40): the caller's OWN shifts across every location as one list, and the same list as an iCalendar file. A person sees only what is theirs and only what is PUBLISHED
// (a draft week does not exist for staff, AF1), with the place they work at (name and address: they are told where to go) and nothing about anybody else: no co-worker, no other shift of the
// location. Whose shifts "mine" are is `ctx.me` (the creator for an API key). Every other roster read is cut by `inScopeSql`; this one is cut by the person, so it needs no location view at all.

/** The calendar download is limited per person: 20 a minute (a calendar app asks once; a script asking more is held back). */
export const ICS_RATE = { limit: 20, windowSec: 60 }

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const DEFAULT_DAYS = 27
const MAX_DAYS = 366
/** Most shifts one read returns (a person has a handful a week: this is a ceiling, `truncated` says when it was hit). */
export const MINE_LIMIT = 2000

/** `from` (default today in the tenant zone) .. `to` (default from + 27 days), real dates, to not before from, at most 366 days. 422 invalid_range otherwise. */
export function mineRange(ctx: Pick<RosterCtx, "now" | "tz">, q: { from?: string; to?: string }): { from: string; to: string } {
  const from = q.from ?? todayOf(ctx)
  const to = q.to ?? addDays(from, DEFAULT_DAYS)
  if (!realDate(from) || !realDate(to) || to < from) throw unprocessable("invalid_range")
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > MAX_DAYS * 86_400_000) throw unprocessable("invalid_range")
  return { from, to }
}

/** GET /v1/roster/mine?from=&to=: the caller's shifts of PUBLISHED weeks, by start date then time. */
export async function myRoster(tx: TenantTx, ctx: RosterCtx, q: { from?: string; to?: string }): Promise<MineDto> {
  const { from, to } = mineRange(ctx, q)
  const rows = await tx
    .select({ s: rosterShifts, locName: locations.name, locAddress: locations.address, zone: locations.timeZone, typeName: shiftTypes.name })
    .from(rosterShifts)
    .innerJoin(rosterWeeks, and(eq(rosterWeeks.tenantId, rosterShifts.tenantId), eq(rosterWeeks.id, rosterShifts.weekId)))
    .innerJoin(locations, and(eq(locations.tenantId, rosterShifts.tenantId), eq(locations.id, rosterShifts.locationId)))
    .innerJoin(shiftTypes, and(eq(shiftTypes.tenantId, rosterShifts.tenantId), eq(shiftTypes.id, rosterShifts.shiftTypeId)))
    .where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.userId, ctx.me), eq(rosterWeeks.status, "published"), between(rosterShifts.date, from, to)))
    .orderBy(asc(rosterShifts.date), asc(rosterShifts.startAt), asc(rosterShifts.id))
    .limit(MINE_LIMIT + 1)
  return {
    from, to, truncated: rows.length > MINE_LIMIT,
    items: rows.slice(0, MINE_LIMIT).map(({ s, locName, locAddress, zone, typeName }) => ({
      id: s.id, date: s.date, start: s.startTime, end: s.endTime, startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(), unpaidBreakMin: s.unpaidBreakMin, role: s.role, shiftType: typeName,
      confirmedAt: s.confirmedAt?.toISOString() ?? null, version: s.version, locationId: s.locationId, locationName: locName, locationAddress: locAddress, timeZone: zone ?? ctx.tz,
    })),
  }
}

/**
 * GET /v1/roster/mine.ics: the same shifts as an iCalendar file (R8-16): UTC instants straight from the stored `start_at` / `end_at` (so the 24 Oct 2026 night is 9 real hours), UID
 * `<shift uuid>@<uidHost>` (tenant-unique, stable), CRLF, folded at 75 octets, every text value escaped. Title, time and the place only: the summary is "role at place", the location is its name
 * and address (what the person already sees in My roster), the description the shift type and the break. No other person, no confirmation state, no id beyond the shift's own.
 */
export async function myIcs(tx: TenantTx, ctx: RosterCtx, q: { from?: string; to?: string }, uidHost: string): Promise<string> {
  const mine = await myRoster(tx, ctx, q)
  return buildIcs(
    mine.items.map((s) => ({
      id: s.id, version: s.version, date: s.date, start: s.start, end: s.end, startAt: Date.parse(s.startAt), endAt: Date.parse(s.endAt),
      title: `${s.role} at ${s.locationName}`, location: s.locationAddress ? `${s.locationName}, ${s.locationAddress}` : s.locationName,
      description: s.unpaidBreakMin > 0 ? `${s.shiftType}. Unpaid break ${s.unpaidBreakMin} min.` : s.shiftType,
    })),
    { tz: ctx.tz, now: ctx.now.getTime(), uidHost, calendarName: "My roster" },
  )
}
