import { and, asc, between, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm"
import { dayColumns, rosterRange, type RosterShift, type RosterWeek, type ShiftTemplate, type StaffingTarget } from "@opsdesk/domain/rosters"
import { addDays, weekdayOf, weekStart as mondayOf, type Weekday } from "@opsdesk/domain/shifts"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { locations, memberships, rosterShifts, rosterWeeks, shiftTypes, shiftTypeTargets, user } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { ShiftDto, ShiftTypeDto, WeekDto, WeeksDto } from "./dto"
import { realDate, todayOf } from "./qualifications"
import { accessInfo, assertLocation, canSeePerson, inScopeSql, type RosterCtx } from "./scope"
import { auditRoster, isUuid, writeHistory } from "./write"

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")

export type WeekRow = typeof rosterWeeks.$inferSelect
export type ShiftRow = typeof rosterShifts.$inferSelect

/** A shift as the API shows it: wall strings plus the stored instants (R8-2). */
export const shiftDto = (r: ShiftRow): ShiftDto => ({
  id: r.id, weekId: r.weekId, locationId: r.locationId, date: r.date, userId: r.userId, shiftTypeId: r.shiftTypeId, role: r.role, start: r.startTime, end: r.endTime,
  unpaidBreakMin: r.unpaidBreakMin, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString(), confirmedAt: r.confirmedAt?.toISOString() ?? null, version: r.version,
})

/** What history, audit and events keep of a shift: ids and wall values only, never a name (R8-13). */
export const shiftSnap = (r: ShiftRow) => ({ shiftId: r.id, weekId: r.weekId, date: r.date, userId: r.userId, shiftTypeId: r.shiftTypeId, role: r.role, start: r.startTime, end: r.endTime, unpaidBreakMin: r.unpaidBreakMin })

export type LoadedWeek = { week: WeekRow; zone: string; archived: boolean }

/**
 * The week the caller may see, with its location's zone. A non-uuid id never reaches SQL; a missing, another tenant's and a hidden week are the same plain 404 (R8-4).
 * The visibility check runs on an unlocked read, THEN the row is locked FOR UPDATE and re-read (a hidden week is never locked on the caller's behalf).
 */
export async function loadWeek(tx: TenantTx, ctx: RosterCtx, id: string, lock: boolean): Promise<LoadedWeek> {
  if (!isUuid(id)) throw NotFound()
  const base = () =>
    tx
      .select({ w: rosterWeeks, zone: locations.timeZone, archivedAt: locations.archivedAt })
      .from(rosterWeeks)
      .innerJoin(locations, and(eq(locations.tenantId, rosterWeeks.tenantId), eq(locations.id, rosterWeeks.locationId)))
      .where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.id, id)))
  const [first] = await base()
  if (!first) throw NotFound()
  assertLocation(ctx, first.w.locationId)
  if (!lock) return { week: first.w, zone: first.zone ?? ctx.tz, archived: first.archivedAt !== null }
  const [row] = await base().for("update", { of: rosterWeeks })
  if (!row) throw NotFound()
  return { week: row.w, zone: row.zone ?? ctx.tz, archived: row.archivedAt !== null }
}

/** Monday of a real calendar date, or 422 invalid_week_start. */
const isMonday = (d: string): boolean => realDate(d) && weekdayOf(d) === 1

/**
 * A week of the site was made by hand: the auto-repeat back-off and failure count of the site are history (job state only: the location row's version and `updated_at` do not move).
 * Only when it matters: the site is backed off (failures > 0) AND one of the Mondays made is a week the sweep would draft itself, i.e. the successor of a PUBLISHED week of the site with
 * auto-repeat on, within that week's `days` of today in the site's zone (the sweep's own window, jobs.ts `candidates`). A far-away or unrelated week changes nothing.
 */
export async function clearAutoRepeatBackoff(tx: TenantTx, ctx: Pick<RosterCtx, "tenantId" | "tz" | "now">, locationId: string, mondays: string[]): Promise<void> {
  if (mondays.length === 0) return
  const [loc] = await tx.select({ zone: locations.timeZone, failures: locations.autoRepeatFailures }).from(locations).where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, locationId)))
  if (!loc || loc.failures <= 0) return
  const sources = await tx
    .select({ weekStart: rosterWeeks.weekStart, days: rosterWeeks.autoRepeatDays })
    .from(rosterWeeks)
    .where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.locationId, locationId), eq(rosterWeeks.status, "published"), sql`${rosterWeeks.autoRepeatDays} is not null`, inArray(rosterWeeks.weekStart, mondays.map((m) => addDays(m, -7)))))
  const today = todayOf({ now: ctx.now, tz: loc.zone ?? ctx.tz })
  const inWindow = sources.some((s) => {
    const ahead = Math.round((Date.parse(`${addDays(s.weekStart, 7)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    return ahead >= 0 && ahead <= s.days!
  })
  if (!inWindow) return
  await tx.update(locations).set({ autoRepeatAttemptAt: null, autoRepeatFailures: 0 }).where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, locationId), sql`${locations.autoRepeatFailures} > 0`))
}

/** POST /v1/roster/weeks: an empty draft week of a location the caller may edit. A second create for the same Monday is 409 week_exists carrying the existing id. */
export async function createWeek(tx: TenantTx, ctx: RosterCtx, input: { locationId: string; weekStart: string }): Promise<WeekDto> {
  if (!ctx.access.editDraft) throw Forbidden("forbidden") // the route guard already answered; fail closed
  assertLocation(ctx, input.locationId) // not a uuid, hidden, another tenant's and missing: one 404, before the id reaches SQL
  if (!isMonday(input.weekStart)) throw unprocessable("invalid_week_start")
  const [loc] = await tx.select({ archivedAt: locations.archivedAt }).from(locations).where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, input.locationId))).for("share")
  if (!loc) throw NotFound()
  if (loc.archivedAt) throw Conflict("location_archived")
  const [existing] = await tx.select({ id: rosterWeeks.id }).from(rosterWeeks).where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.locationId, input.locationId), eq(rosterWeeks.weekStart, input.weekStart)))
  if (existing) throw new AppError(409, "week_exists", "Conflict", { weekId: existing.id })
  const [row] = await tx.insert(rosterWeeks).values({ tenantId: ctx.tenantId, locationId: input.locationId, weekStart: input.weekStart, createdAt: ctx.now, updatedAt: ctx.now }).returning()
  await clearAutoRepeatBackoff(tx, ctx, input.locationId, [input.weekStart])
  await writeHistory(tx, ctx, { locationId: row.locationId, weekId: row.id, action: "week_created", after: { weekId: row.id, weekStart: row.weekStart } })
  await auditRoster(tx, ctx, { action: "roster.week_created", entity: "roster_week", entityId: row.id, before: null, after: { locationId: row.locationId, weekStart: row.weekStart } })
  return weekDto(ctx, row, [], [], [])
}

const VIEWS = ["day", "week", "fortnight", "month"] as const
type View = (typeof VIEWS)[number]
const MAX_RANGE_DAYS = 62

const targetsOf = (rows: { shiftTypeId: string; weekday: number; count: number }[], types: { id: string; locationId: string }[]): StaffingTarget[] => {
  const loc = new Map(types.map((t) => [t.id, t.locationId]))
  return rows.map((r) => ({ locationId: loc.get(r.shiftTypeId)!, templateId: r.shiftTypeId, weekday: r.weekday as Weekday, count: r.count }))
}

function weekDto(ctx: RosterCtx, w: WeekRow, shifts: ShiftRow[], types: { id: string; locationId: string; name: string; start: string; end: string; unpaidBreakMin: number; role: string; requires: string[] }[], targets: StaffingTarget[]): WeekDto {
  const domainWeek: RosterWeek = { id: w.id, locationId: w.locationId, weekStart: w.weekStart, status: w.status as "draft" | "published", publishedAt: null, publishedBy: null, autoRepeatDays: w.autoRepeatDays }
  const domainShifts: RosterShift[] = shifts.map((s) => ({ id: s.id, weekId: s.weekId, locationId: s.locationId, date: s.date, personId: s.userId, templateId: s.shiftTypeId, role: s.role, start: s.startTime, end: s.endTime, unpaidBreakMin: s.unpaidBreakMin, confirmedAt: null }))
  const templates: ShiftTemplate[] = types.map((t) => ({ id: t.id, locationId: t.locationId, name: t.name, start: t.start, end: t.end, unpaidBreakMin: t.unpaidBreakMin, role: t.role, requires: t.requires }))
  const days = dayColumns(domainWeek, domainShifts, targets, templates).map((d) => ({ date: d.date, shiftIds: d.shifts.map((s) => s.id), count: d.count, target: d.target, short: d.short, over: d.over }))
  return { id: w.id, locationId: w.locationId, weekStart: w.weekStart, status: domainWeek.status, publishedAt: w.publishedAt?.toISOString() ?? null, publishedBy: w.publishedBy, autoRepeatDays: w.autoRepeatDays, version: w.version, days, access: accessInfo(ctx, domainWeek.status) }
}

/**
 * The read payload of a set of weeks: weeks with their seven day columns (the domain `dayColumns`), their shifts, the shift types of their locations with targets,
 * and the members the caller may pick from. Everything is cut by `inScopeSql` / the weeks' own locations, so another location never appears in any array.
 * Members: active people homed at a visible location (a role that sees every site also those homed nowhere) and everyone on a shown shift; a supervisor never gets a home
 * location, anyone else only a visible one.
 */
/** What the weeks of a read need: their shifts, the shift types of their locations with targets. One statement each, however many weeks. */
async function loadWeekData(tx: TenantTx, ctx: RosterCtx, weeks: WeekRow[]) {
  const weekIds = weeks.map((w) => w.id)
  const locationIds = [...new Set(weeks.map((w) => w.locationId))]
  const shifts = weekIds.length
    ? await tx.select().from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), inArray(rosterShifts.weekId, weekIds))).orderBy(asc(rosterShifts.date), asc(rosterShifts.startTime), asc(rosterShifts.id))
    : []
  const types = locationIds.length
    ? await tx.select().from(shiftTypes).where(and(eq(shiftTypes.tenantId, ctx.tenantId), inArray(shiftTypes.locationId, locationIds))).orderBy(asc(shiftTypes.startTime), sql`lower(${shiftTypes.name})`, asc(shiftTypes.id))
    : []
  const targetRows = types.length ? await tx.select().from(shiftTypeTargets).where(and(eq(shiftTypeTargets.tenantId, ctx.tenantId), inArray(shiftTypeTargets.shiftTypeId, types.map((t) => t.id)))).orderBy(asc(shiftTypeTargets.weekday)) : []
  const flat = types.map((t) => ({ id: t.id, locationId: t.locationId, name: t.name, start: t.startTime, end: t.endTime, unpaidBreakMin: t.unpaidBreakMin, role: t.role, requires: t.requires }))
  return { shifts, types, targetRows, flat, targets: targetsOf(targetRows, flat) }
}

/** The weeks as the API shows them (7 day columns each), for a caller that does not need the members or shift types (repeat, template apply). */
export async function weekDtos(tx: TenantTx, ctx: RosterCtx, weeks: WeekRow[]): Promise<WeekDto[]> {
  const d = await loadWeekData(tx, ctx, weeks)
  return weeks.map((w) => weekDto(ctx, w, d.shifts.filter((s) => s.weekId === w.id), d.flat.filter((t) => t.locationId === w.locationId), d.targets.filter((t) => t.locationId === w.locationId)))
}

/** The member list of a read is bounded (the picker pages later): everyone on a shown shift, then at most this many other people. `membersTruncated` says more exist. */
export const MEMBERS_CAP = 500

/**
 * The read payload of a set of weeks: weeks with their seven day columns (the domain `dayColumns`), their shifts, the shift types of their locations with targets,
 * and the members the caller may pick from. Everything is cut by `inScopeSql` / the weeks' own locations, so another location never appears in any array.
 * Members: active people homed at a visible location (a role that sees every site also those homed nowhere) and everyone on a shown shift; a supervisor never gets a home
 * location, anyone else only a visible one. The pick list is capped at MEMBERS_CAP (`membersTruncated`); the people ON a shown shift are always included.
 */
async function payload(tx: TenantTx, ctx: RosterCtx, weeks: WeekRow[], range: WeeksDto["range"]): Promise<WeeksDto> {
  const { shifts, types, targetRows, flat, targets } = await loadWeekData(tx, ctx, weeks)
  const onShifts = [...new Set(shifts.map((s) => s.userId).filter((u): u is string => u !== null))].sort()
  const homeCut = ctx.access.scope === "all" ? sql`(${memberships.homeLocationId} is null or ${inScopeSql(ctx, memberships.homeLocationId)})` : inScopeSql(ctx, memberships.homeLocationId)
  const pick = (extra: SQL | undefined, limit: number) =>
    tx
      .select({ userId: memberships.userId, name: user.name, erased: user.erasedAt, status: memberships.status, home: memberships.homeLocationId })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(memberships.tenantId, ctx.tenantId), extra))
      .orderBy(asc(memberships.userId))
      .limit(limit)
  const shown = onShifts.length ? await pick(inArray(memberships.userId, onShifts), onShifts.length) : []
  const others = await pick(and(eq(memberships.status, "active"), homeCut, onShifts.length ? notInArray(memberships.userId, onShifts) : undefined), MEMBERS_CAP + 1)
  const membersTruncated = others.length > MEMBERS_CAP
  const members = [...shown, ...others.slice(0, MEMBERS_CAP)].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
  const seesHome = ctx.access.scope === "all"
  const typeDtos: ShiftTypeDto[] = types.map((t) => ({
    id: t.id, locationId: t.locationId, name: t.name, start: t.startTime, end: t.endTime, unpaidBreakMin: t.unpaidBreakMin, role: t.role, requires: t.requires,
    targets: targetRows.filter((r) => r.shiftTypeId === t.id).map((r) => ({ weekday: r.weekday, count: r.count })), archived: t.archivedAt !== null, version: t.version,
  }))
  return {
    range,
    weeks: weeks.map((w) => weekDto(ctx, w, shifts.filter((s) => s.weekId === w.id), flat.filter((t) => t.locationId === w.locationId), targets.filter((t) => t.locationId === w.locationId))),
    shifts: shifts.map(shiftDto),
    shiftTypes: typeDtos,
    members: members.map((m) => ({ userId: m.userId, name: !canSeePerson(ctx, m.userId, m.home) ? "Member" : m.erased ? "Erased user" : m.name, active: !canSeePerson(ctx, m.userId, m.home) || m.status === "active", homeLocationId: seesHome && m.home && ctx.access.locationIds?.includes(m.home) ? m.home : null })),
    membersTruncated,
    access: accessInfo(ctx),
  }
}

/** GET /v1/roster/weeks?locationId=&from=&to=&view=: the weeks of the range for the caller's visible locations. A caller with no location view (staff) gets an empty cut, never someone else's roster. */
export async function listWeeks(tx: TenantTx, ctx: RosterCtx, q: { locationId?: string; from?: string; to?: string; view?: string }): Promise<WeeksDto> {
  const view = q.view ?? "week"
  if (!(VIEWS as readonly string[]).includes(view)) throw unprocessable("invalid_view")
  const anchor = q.from ?? todayOf(ctx)
  if (!realDate(anchor) || (q.to !== undefined && (!realDate(q.to) || q.to < anchor))) throw unprocessable("invalid_range")
  const range = q.to ? { from: anchor, to: q.to } : rosterRange(view as View, anchor)
  if (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`) > MAX_RANGE_DAYS * 86_400_000) throw unprocessable("invalid_range")
  if (q.locationId !== undefined) assertLocation(ctx, q.locationId)
  const weeks = await tx
    .select()
    .from(rosterWeeks)
    .where(and(eq(rosterWeeks.tenantId, ctx.tenantId), inScopeSql(ctx, rosterWeeks.locationId), q.locationId ? eq(rosterWeeks.locationId, q.locationId) : undefined, between(rosterWeeks.weekStart, mondayOf(range.from), range.to)))
    .orderBy(asc(rosterWeeks.weekStart), asc(rosterWeeks.locationId), asc(rosterWeeks.id))
  return payload(tx, ctx, weeks, { ...range, view: view as View })
}

/** GET /v1/roster/weeks/{id}: the same payload for one week. */
export async function getWeek(tx: TenantTx, ctx: RosterCtx, id: string): Promise<WeeksDto> {
  const { week } = await loadWeek(tx, ctx, id, false)
  return payload(tx, ctx, [week], { from: week.weekStart, to: addDays(week.weekStart, 6), view: "week" })
}
