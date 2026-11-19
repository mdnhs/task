import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { addDays, hmMinutes, isHm, isTimeZone, wallToEpoch } from "@opsdesk/domain/shifts"
import { AppError, Conflict, NotFound } from "../../core/errors"
import { locations, locationSupervisors, memberships, rosterOfficeLimits, rosterShifts, rosterWeeks, roles, shiftTypes, shiftTypeTargets } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { notify } from "../notifications"
import { notifyActive } from "./events"
import { canonicalTimezone } from "../settings"
import type { LocationDto, ShiftTypeDto } from "./dto"
import { assertLocation, inScopeSql, type RosterCtx } from "./scope"
import { auditRoster, isUuid, officeOnly, publishRoster, unrestrictedOffice, writeHistory, type RosterEnv } from "./write"

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")

type LocationRow = typeof locations.$inferSelect
type ShiftTypeRow = typeof shiftTypes.$inferSelect

// ------------------------------------------------------------------ helpers

const toDto = (r: LocationRow, supervisorIds: string[]): LocationDto => ({
  id: r.id, name: r.name, address: r.address, lat: r.lat, lng: r.lng, zoneRadiusM: r.zoneRadiusM, openingHours: r.openingHours, contact: r.contact,
  swapApprovalDelegated: r.swapApprovalDelegated, timeZone: r.timeZone, version: r.version, archived: r.archivedAt !== null, supervisorIds,
})
/** What the audit and history lines keep of a location (no supervisor list: that has its own line). */
const snap = (r: LocationRow) => ({ name: r.name, address: r.address, lat: r.lat, lng: r.lng, zoneRadiusM: r.zoneRadiusM, openingHours: r.openingHours, contact: r.contact, swapApprovalDelegated: r.swapApprovalDelegated, timeZone: r.timeZone, archived: r.archivedAt !== null })

/** The ACTIVE supervisors of each location (a deactivated person keeps the grant row but does not supervise). */
async function supervisorsOf(tx: TenantTx, tenantId: string, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  if (ids.length === 0) return out
  const rows = await tx
    .select({ locationId: locationSupervisors.locationId, userId: locationSupervisors.userId })
    .from(locationSupervisors)
    .innerJoin(memberships, and(eq(memberships.tenantId, locationSupervisors.tenantId), eq(memberships.userId, locationSupervisors.userId), eq(memberships.status, "active")))
    .where(and(eq(locationSupervisors.tenantId, tenantId), inArray(locationSupervisors.locationId, ids)))
    .orderBy(asc(locationSupervisors.userId))
  for (const r of rows) out.get(r.locationId)!.push(r.userId)
  return out
}

/** A location the caller may see, locked FOR UPDATE for a mutation. The visibility check runs BEFORE the id reaches SQL (non-uuid = missing = hidden = another tenant's: one 404). */
async function loadLocation(tx: TenantTx, ctx: RosterCtx, id: string, lock: boolean): Promise<LocationRow> {
  assertLocation(ctx, id)
  const q = tx.select().from(locations).where(and(eq(locations.id, id), eq(locations.tenantId, ctx.tenantId)))
  const [row] = lock ? await q.for("update") : await q
  if (!row) throw NotFound()
  return row
}
const notArchived = (r: Pick<LocationRow, "archivedAt">): void => {
  if (r.archivedAt) throw Conflict("location_archived")
}

// ------------------------------------------------------------------ validation

const CTRL = /[\u0000-\u001f\u007f]/
const oneLine = (v: string, min: number, max: number, code: string): string => {
  const s = v.trim()
  if (s.length < min || s.length > max || CTRL.test(s)) throw unprocessable(code)
  return s
}

type LocationInput = Partial<{ name: string; address: string; lat: number | null; lng: number | null; zoneRadiusM: number | null; openingHours: Record<string, string>; contact: string; swapApprovalDelegated: boolean; timeZone: string | null }>

/** Validates and normalises the fields of a location; the caller merges them over the current row and re-checks the pair rule (lat and lng come together). */
function checkLocation(v: LocationInput): LocationInput {
  const out: LocationInput = {}
  if (v.name !== undefined) out.name = oneLine(v.name, 1, 120, "invalid_location")
  if (v.address !== undefined) {
    const a = v.address.trim()
    if (a.length > 300 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(a)) throw unprocessable("invalid_location")
    out.address = a
  }
  if (v.contact !== undefined) {
    const k = v.contact.trim()
    if (k.length > 200 || CTRL.test(k)) throw unprocessable("invalid_location")
    out.contact = k
  }
  if (v.lat !== undefined) {
    if (v.lat !== null && (!Number.isFinite(v.lat) || v.lat < -90 || v.lat > 90)) throw unprocessable("invalid_coordinates")
    out.lat = v.lat
  }
  if (v.lng !== undefined) {
    if (v.lng !== null && (!Number.isFinite(v.lng) || v.lng < -180 || v.lng > 180)) throw unprocessable("invalid_coordinates")
    out.lng = v.lng
  }
  if (v.zoneRadiusM !== undefined) {
    if (v.zoneRadiusM !== null && (!Number.isInteger(v.zoneRadiusM) || v.zoneRadiusM < 0 || v.zoneRadiusM > 5000)) throw unprocessable("invalid_zone_radius")
    out.zoneRadiusM = v.zoneRadiusM
  }
  if (v.openingHours !== undefined) {
    if (Object.keys(v.openingHours).length > 14 || JSON.stringify(v.openingHours).length > 2000) throw unprocessable("invalid_location")
    out.openingHours = v.openingHours
  }
  if (v.swapApprovalDelegated !== undefined) out.swapApprovalDelegated = v.swapApprovalDelegated
  if (v.timeZone !== undefined) {
    if (v.timeZone === null) out.timeZone = null
    else {
      const tz = canonicalTimezone(v.timeZone.trim())
      if (!tz || !isTimeZone(tz)) throw unprocessable("invalid_time_zone") // service-level IANA check (the column only stores text)
      out.timeZone = tz
    }
  }
  return out
}

async function assertNameFree(tx: TenantTx, tenantId: string, name: string, exceptId?: string): Promise<void> {
  const rows = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.tenantId, tenantId), sql`lower(${locations.name}) = lower(${name})`, isNull(locations.archivedAt)))
  if (rows.some((r) => r.id !== exceptId)) throw Conflict("location_name_taken")
}

/**
 * The shift's start and end instants as epoch milliseconds: wall times in the location's zone (the R8-1 DST rule lives in wallToEpoch); end at or before start
 * means the next day (FR-RS-21: the shift counts on its start date). Numbers, not Dates: this module never builds a Date from the wall clock (deps.clock only),
 * so SQL turns them into timestamptz (`instantSql`).
 */
export function shiftInstants(date: string, start: string, end: string, zone: string): { startAt: number; endAt: number } {
  const endDate = hmMinutes(end) <= hmMinutes(start) ? addDays(date, 1) : date
  return { startAt: wallToEpoch(`${date}T${start}`, zone), endAt: wallToEpoch(`${endDate}T${end}`, zone) }
}
/** An epoch-ms number as a timestamptz value in SQL (exact to the millisecond). */
export const instantSql = (ms: number) => sql`to_timestamp(${ms}::double precision / 1000)`

// ------------------------------------------------------------------ locations: reads

export async function listLocations(tx: TenantTx, ctx: RosterCtx, o: { includeArchived: boolean }): Promise<{ items: LocationDto[] }> {
  const rows = await tx
    .select()
    .from(locations)
    .where(and(eq(locations.tenantId, ctx.tenantId), inScopeSql(ctx, locations.id), o.includeArchived ? undefined : isNull(locations.archivedAt)))
    .orderBy(sql`lower(${locations.name})`, asc(locations.id))
  const sup = await supervisorsOf(tx, ctx.tenantId, rows.map((r) => r.id))
  return { items: rows.map((r) => toDto(r, sup.get(r.id) ?? [])) }
}

export async function getLocation(tx: TenantTx, ctx: RosterCtx, id: string): Promise<LocationDto> {
  const row = await loadLocation(tx, ctx, id, false)
  return toDto(row, (await supervisorsOf(tx, ctx.tenantId, [row.id])).get(row.id) ?? [])
}

// ------------------------------------------------------------------ locations: writes

export async function createLocation(tx: TenantTx, ctx: RosterCtx, input: LocationInput & { name: string }): Promise<LocationDto> {
  officeOnly(ctx)
  const v = checkLocation(input)
  if ((v.lat == null) !== (v.lng == null)) throw unprocessable("invalid_coordinates") // a point is both coordinates or neither
  await assertNameFree(tx, ctx.tenantId, v.name!)
  const [row] = await tx
    .insert(locations)
    .values({
      tenantId: ctx.tenantId, name: v.name!, address: v.address ?? "", lat: v.lat ?? null, lng: v.lng ?? null, zoneRadiusM: v.zoneRadiusM ?? null, openingHours: v.openingHours ?? {},
      contact: v.contact ?? "", swapApprovalDelegated: v.swapApprovalDelegated ?? false, timeZone: v.timeZone ?? null, createdAt: ctx.now, updatedAt: ctx.now,
    })
    .returning()
  await writeHistory(tx, ctx, { locationId: row.id, action: "location_created", after: snap(row) })
  await auditRoster(tx, ctx, { action: "roster.location_created", entity: "location", entityId: row.id, before: null, after: snap(row) })
  return toDto(row, [])
}

export async function patchLocation(tx: TenantTx, ctx: RosterCtx, id: string, input: LocationInput & { version: number }): Promise<LocationDto> {
  officeOnly(ctx)
  const cur = await loadLocation(tx, ctx, id, true)
  if (cur.version !== input.version) throw Conflict("version_conflict")
  notArchived(cur)
  const v = checkLocation(input)
  const next = {
    name: v.name ?? cur.name, address: v.address ?? cur.address, lat: v.lat !== undefined ? v.lat : cur.lat, lng: v.lng !== undefined ? v.lng : cur.lng,
    zoneRadiusM: v.zoneRadiusM !== undefined ? v.zoneRadiusM : cur.zoneRadiusM, openingHours: v.openingHours ?? cur.openingHours, contact: v.contact ?? cur.contact,
    swapApprovalDelegated: v.swapApprovalDelegated ?? cur.swapApprovalDelegated, timeZone: v.timeZone !== undefined ? v.timeZone : cur.timeZone,
  }
  if ((next.lat === null) !== (next.lng === null)) throw unprocessable("invalid_coordinates")
  const sup = (await supervisorsOf(tx, ctx.tenantId, [cur.id])).get(cur.id) ?? []
  const same = JSON.stringify(snap({ ...cur, ...next })) === JSON.stringify(snap(cur))
  if (same) return toDto(cur, sup) // nothing changes: no bump, no history, no audit
  if (next.name.toLowerCase() !== cur.name.toLowerCase()) await assertNameFree(tx, ctx.tenantId, next.name, cur.id)
  const [row] = await tx.update(locations).set({ ...next, version: cur.version + 1, updatedAt: ctx.now }).where(and(eq(locations.id, cur.id), eq(locations.tenantId, ctx.tenantId))).returning()
  // R8-2: a zone change recomputes DRAFT shifts only (their wall times are read in the new zone); published shifts keep their stored instants. Each touched shift bumps its version so an open editor conflicts.
  let recomputed = 0
  if (next.timeZone !== cur.timeZone) {
    const zone = next.timeZone ?? ctx.tz
    const drafts = await tx
      .select({ id: rosterShifts.id, date: rosterShifts.date, start: rosterShifts.startTime, end: rosterShifts.endTime })
      .from(rosterShifts)
      .innerJoin(rosterWeeks, and(eq(rosterWeeks.tenantId, rosterShifts.tenantId), eq(rosterWeeks.id, rosterShifts.weekId)))
      .where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.locationId, cur.id), eq(rosterWeeks.status, "draft")))
      .orderBy(asc(rosterShifts.id))
      .for("update", { of: rosterShifts })
    for (const s of drafts) {
      const t = shiftInstants(s.date, s.start, s.end, zone)
      await tx.update(rosterShifts).set({ startAt: instantSql(t.startAt), endAt: instantSql(t.endAt), version: sql`${rosterShifts.version} + 1`, updatedAt: ctx.now }).where(and(eq(rosterShifts.id, s.id), eq(rosterShifts.tenantId, ctx.tenantId)))
    }
    recomputed = drafts.length
  }
  await writeHistory(tx, ctx, { locationId: cur.id, action: "location_updated", before: snap(cur), after: { ...snap(row), ...(recomputed ? { recomputedDraftShifts: recomputed } : {}) } })
  await auditRoster(tx, ctx, { action: "roster.location_updated", entity: "location", entityId: cur.id, before: snap(cur), after: snap(row) })
  return toDto(row, sup)
}

/** POST /archive: a location is never deleted. Idempotent (an archived one answers 200 again). Its weeks, shifts and history stay readable. */
export async function archiveLocation(tx: TenantTx, ctx: RosterCtx, id: string): Promise<LocationDto> {
  officeOnly(ctx)
  const cur = await loadLocation(tx, ctx, id, true)
  const sup = (await supervisorsOf(tx, ctx.tenantId, [cur.id])).get(cur.id) ?? []
  if (cur.archivedAt) return toDto(cur, sup)
  const [row] = await tx.update(locations).set({ archivedAt: ctx.now, version: cur.version + 1, updatedAt: ctx.now }).where(and(eq(locations.id, cur.id), eq(locations.tenantId, ctx.tenantId))).returning()
  await writeHistory(tx, ctx, { locationId: cur.id, action: "location_archived", before: snap(cur), after: snap(row) })
  await auditRoster(tx, ctx, { action: "roster.location_archived", entity: "location", entityId: cur.id, before: snap(cur), after: snap(row) })
  return toDto(row, sup)
}

// ------------------------------------------------------------------ supervisors (FR-RS-03, FR-RS-34)

/**
 * PUT supervisors: the new set replaces the old one. Every id must be an ACTIVE member of the tenant (422 invalid_supervisor otherwise; the member rows are
 * locked FOR SHARE so a concurrent deactivation waits). An unchanged set writes nothing. A change writes history, notifies the people added and removed,
 * audits the old and the new set (FR-RS-34) and publishes `location.supervisors_changed` once.
 */
export async function setSupervisors(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, id: string, userIds: string[]): Promise<{ locationId: string; userIds: string[] }> {
  officeOnly(ctx)
  const loc = await loadLocation(tx, ctx, id, true)
  notArchived(loc)
  const next = [...new Set(userIds)].sort()
  if (next.length > 0) {
    const active = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active"), inArray(memberships.userId, next)))
      .orderBy(asc(memberships.userId))
      .for("share")
    if (active.length !== next.length) throw unprocessable("invalid_supervisor")
  }
  const old = (await tx.select({ userId: locationSupervisors.userId }).from(locationSupervisors).where(and(eq(locationSupervisors.tenantId, ctx.tenantId), eq(locationSupervisors.locationId, loc.id))).orderBy(asc(locationSupervisors.userId)).for("update")).map((r) => r.userId).sort() // JS order like `next` (the DB collation may order mixed-case ids differently)
  const added = next.filter((u) => !old.includes(u))
  const removed = old.filter((u) => !next.includes(u))
  if (added.length === 0 && removed.length === 0) return { locationId: loc.id, userIds: next }
  if (removed.length) await tx.delete(locationSupervisors).where(and(eq(locationSupervisors.tenantId, ctx.tenantId), eq(locationSupervisors.locationId, loc.id), inArray(locationSupervisors.userId, removed)))
  if (added.length) await tx.insert(locationSupervisors).values(added.map((userId) => ({ tenantId: ctx.tenantId, locationId: loc.id, userId, createdBy: ctx.actorId, createdAt: ctx.now })))
  await writeHistory(tx, ctx, { locationId: loc.id, action: "supervisors_changed", before: { userIds: old }, after: { userIds: next } })
  // ACTIVE members only (ruling AE): the grant of a member who was deactivated meanwhile is taken away silently
  await notifyActive(tx, ctx, env, [
    ...added.map((userId) => ({ userId, title: "You now supervise a location", body: `You are a supervisor of ${loc.name}.` })),
    ...removed.map((userId) => ({ userId, title: "Location supervision ended", body: `You no longer supervise ${loc.name}.` })),
  ])
  await auditRoster(tx, ctx, { action: "roster.supervisors_changed", entity: "location", entityId: loc.id, before: { userIds: old }, after: { userIds: next } })
  await publishRoster(tx, ctx, "location.supervisors_changed", { locationId: loc.id, added, removed })
  return { locationId: loc.id, userIds: next }
}

// ------------------------------------------------------------------ shift types (FR-RS-30..33)

const toTypeDto = (r: ShiftTypeRow, targets: { weekday: number; count: number }[]): ShiftTypeDto => ({
  id: r.id, locationId: r.locationId, name: r.name, start: r.startTime, end: r.endTime, unpaidBreakMin: r.unpaidBreakMin, role: r.role, requires: r.requires,
  targets: [...targets].sort((a, b) => a.weekday - b.weekday), archived: r.archivedAt !== null, version: r.version,
})
const typeSnap = (r: ShiftTypeRow) => ({ name: r.name, start: r.startTime, end: r.endTime, unpaidBreakMin: r.unpaidBreakMin, role: r.role, requires: r.requires, archived: r.archivedAt !== null })

async function targetsOf(tx: TenantTx, tenantId: string, ids: string[]): Promise<Map<string, { weekday: number; count: number }[]>> {
  const out = new Map<string, { weekday: number; count: number }[]>(ids.map((id) => [id, []]))
  if (ids.length === 0) return out
  const rows = await tx.select().from(shiftTypeTargets).where(and(eq(shiftTypeTargets.tenantId, tenantId), inArray(shiftTypeTargets.shiftTypeId, ids))).orderBy(asc(shiftTypeTargets.weekday))
  for (const r of rows) out.get(r.shiftTypeId)!.push({ weekday: r.weekday, count: r.count })
  return out
}

/** A shift type the caller may see (its location is in scope), locked FOR UPDATE for a mutation. Missing, hidden, other tenant's and not-a-uuid all give the one plain 404 (no `shift_type_not_found` that a hidden site would not share). */
async function loadType(tx: TenantTx, ctx: RosterCtx, id: string, lock: boolean): Promise<ShiftTypeRow> {
  if (!isUuid(id)) throw NotFound()
  const q = tx.select().from(shiftTypes).where(and(eq(shiftTypes.id, id), eq(shiftTypes.tenantId, ctx.tenantId)))
  const [row] = lock ? await q.for("update") : await q
  if (!row) throw NotFound()
  assertLocation(ctx, row.locationId)
  return row
}

type TypeInput = Partial<{ name: string; start: string; end: string; unpaidBreakMin: number; role: string; requires: string[] }>
/** The canonical qualification key: trimmed and lower case, so 'First Aid' and 'first aid' are ONE key wherever it is written or compared (shift type `requires`, `member_qualifications.type`). */
export const qualificationKey = (raw: string): string => raw.trim().toLowerCase()

/** Canonical (trimmed, lower-case) free-text qualification keys, deduplicated in first-seen order, at most 20 (FR-RS-04: the same text `member_qualifications.type` holds). */
export function normaliseRequires(v: string[]): string[] {
  const out: string[] = []
  for (const raw of v) {
    const s = qualificationKey(raw)
    if (s.length < 1 || s.length > 80 || CTRL.test(s)) throw unprocessable("invalid_shift_type")
    if (!out.includes(s)) out.push(s)
  }
  if (out.length > 20) throw unprocessable("invalid_shift_type")
  return out
}
function checkType(v: TypeInput): TypeInput {
  const out: TypeInput = {}
  if (v.name !== undefined) out.name = oneLine(v.name, 1, 80, "invalid_shift_type")
  if (v.role !== undefined) out.role = oneLine(v.role, 1, 80, "invalid_shift_type")
  if (v.start !== undefined) {
    if (!isHm(v.start)) throw unprocessable("invalid_shift_type")
    out.start = v.start
  }
  if (v.end !== undefined) {
    if (!isHm(v.end)) throw unprocessable("invalid_shift_type")
    out.end = v.end
  }
  if (v.unpaidBreakMin !== undefined) {
    if (!Number.isInteger(v.unpaidBreakMin) || v.unpaidBreakMin < 0 || v.unpaidBreakMin > 480) throw unprocessable("invalid_shift_type")
    out.unpaidBreakMin = v.unpaidBreakMin
  }
  if (v.requires !== undefined) out.requires = normaliseRequires(v.requires)
  return out
}
/** Start and end differ (an end at or before the start is the overnight rule, but equal would be a 24 h shift: refused) and the unpaid break fits inside the shift. */
function checkTimes(start: string, end: string, unpaidBreakMin: number): void {
  const s = hmMinutes(start)
  const e = hmMinutes(end)
  if (s === e) throw unprocessable("invalid_shift_type")
  const length = e > s ? e - s : e + 1440 - s
  if (unpaidBreakMin >= length) throw unprocessable("invalid_shift_type")
}
async function assertTypeNameFree(tx: TenantTx, tenantId: string, locationId: string, name: string, exceptId?: string): Promise<void> {
  const rows = await tx.select({ id: shiftTypes.id }).from(shiftTypes).where(and(eq(shiftTypes.tenantId, tenantId), eq(shiftTypes.locationId, locationId), sql`lower(${shiftTypes.name}) = lower(${name})`, isNull(shiftTypes.archivedAt)))
  if (rows.some((r) => r.id !== exceptId)) throw Conflict("shift_type_name_taken")
}

export async function listShiftTypes(tx: TenantTx, ctx: RosterCtx, locationId: string, o: { includeArchived: boolean }): Promise<{ items: ShiftTypeDto[] }> {
  const loc = await loadLocation(tx, ctx, locationId, false)
  const rows = await tx
    .select()
    .from(shiftTypes)
    .where(and(eq(shiftTypes.tenantId, ctx.tenantId), eq(shiftTypes.locationId, loc.id), o.includeArchived ? undefined : isNull(shiftTypes.archivedAt)))
    .orderBy(asc(shiftTypes.startTime), sql`lower(${shiftTypes.name})`, asc(shiftTypes.id))
  const targets = await targetsOf(tx, ctx.tenantId, rows.map((r) => r.id))
  return { items: rows.map((r) => toTypeDto(r, targets.get(r.id) ?? [])) }
}

export async function createShiftType(tx: TenantTx, ctx: RosterCtx, locationId: string, input: TypeInput & { name: string; start: string; end: string; role: string }): Promise<ShiftTypeDto> {
  officeOnly(ctx)
  const loc = await loadLocation(tx, ctx, locationId, true)
  notArchived(loc)
  const v = checkType(input)
  checkTimes(v.start!, v.end!, v.unpaidBreakMin ?? 0)
  await assertTypeNameFree(tx, ctx.tenantId, loc.id, v.name!)
  const [row] = await tx
    .insert(shiftTypes)
    .values({ tenantId: ctx.tenantId, locationId: loc.id, name: v.name!, startTime: v.start!, endTime: v.end!, unpaidBreakMin: v.unpaidBreakMin ?? 0, role: v.role!, requires: v.requires ?? [], createdAt: ctx.now, updatedAt: ctx.now })
    .returning()
  await writeHistory(tx, ctx, { locationId: loc.id, action: "shift_type_created", after: { shiftTypeId: row.id, ...typeSnap(row) } })
  await auditRoster(tx, ctx, { action: "roster.shift_type_created", entity: "shift_type", entityId: row.id, before: null, after: typeSnap(row) })
  return toTypeDto(row, [])
}

export async function patchShiftType(tx: TenantTx, ctx: RosterCtx, id: string, input: TypeInput & { version: number }): Promise<ShiftTypeDto> {
  officeOnly(ctx)
  const cur = await loadType(tx, ctx, id, true)
  if (cur.version !== input.version) throw Conflict("version_conflict")
  const targets = (await targetsOf(tx, ctx.tenantId, [cur.id])).get(cur.id) ?? []
  if (cur.archivedAt) throw Conflict("shift_type_archived")
  const v = checkType(input)
  const next = { name: v.name ?? cur.name, startTime: v.start ?? cur.startTime, endTime: v.end ?? cur.endTime, unpaidBreakMin: v.unpaidBreakMin ?? cur.unpaidBreakMin, role: v.role ?? cur.role, requires: v.requires ?? cur.requires }
  checkTimes(next.startTime, next.endTime, next.unpaidBreakMin)
  if (JSON.stringify(typeSnap({ ...cur, ...next })) === JSON.stringify(typeSnap(cur))) return toTypeDto(cur, targets)
  if (next.name.toLowerCase() !== cur.name.toLowerCase()) await assertTypeNameFree(tx, ctx.tenantId, cur.locationId, next.name, cur.id)
  // Rostered shifts COPY the type's times, role and break, so this edit never rewrites a shift that already exists.
  const [row] = await tx.update(shiftTypes).set({ ...next, version: cur.version + 1, updatedAt: ctx.now }).where(and(eq(shiftTypes.id, cur.id), eq(shiftTypes.tenantId, ctx.tenantId))).returning()
  await writeHistory(tx, ctx, { locationId: cur.locationId, action: "shift_type_updated", before: { shiftTypeId: cur.id, ...typeSnap(cur) }, after: { shiftTypeId: cur.id, ...typeSnap(row) } })
  await auditRoster(tx, ctx, { action: "roster.shift_type_updated", entity: "shift_type", entityId: cur.id, before: typeSnap(cur), after: typeSnap(row) })
  return toTypeDto(row, targets)
}

/** DELETE = archive (never a hard delete: rostered shifts reference the type and keep reading it). Always succeeds, repeat included. */
export async function archiveShiftType(tx: TenantTx, ctx: RosterCtx, id: string): Promise<void> {
  officeOnly(ctx)
  const cur = await loadType(tx, ctx, id, true)
  if (cur.archivedAt) return
  const [row] = await tx.update(shiftTypes).set({ archivedAt: ctx.now, version: cur.version + 1, updatedAt: ctx.now }).where(and(eq(shiftTypes.id, cur.id), eq(shiftTypes.tenantId, ctx.tenantId))).returning()
  await writeHistory(tx, ctx, { locationId: cur.locationId, action: "shift_type_archived", before: { shiftTypeId: cur.id, ...typeSnap(cur) }, after: { shiftTypeId: cur.id, ...typeSnap(row) } })
  await auditRoster(tx, ctx, { action: "roster.shift_type_archived", entity: "shift_type", entityId: cur.id, before: typeSnap(cur), after: typeSnap(row) })
}

/** PUT targets: the staffing target per weekday (0 = Sunday ... 6, count 0..99), replacing the whole set. One entry per weekday. */
export async function setTargets(tx: TenantTx, ctx: RosterCtx, id: string, targets: { weekday: number; count: number }[]): Promise<ShiftTypeDto> {
  officeOnly(ctx)
  const cur = await loadType(tx, ctx, id, true)
  if (cur.archivedAt) throw Conflict("shift_type_archived")
  const days = new Set<number>()
  for (const t of targets) {
    if (!Number.isInteger(t.weekday) || t.weekday < 0 || t.weekday > 6 || !Number.isInteger(t.count) || t.count < 0 || t.count > 99 || days.has(t.weekday)) throw unprocessable("invalid_targets")
    days.add(t.weekday)
  }
  const next = [...targets].sort((a, b) => a.weekday - b.weekday)
  const old = (await targetsOf(tx, ctx.tenantId, [cur.id])).get(cur.id) ?? []
  if (JSON.stringify(old) === JSON.stringify(next)) return toTypeDto(cur, old)
  await tx.delete(shiftTypeTargets).where(and(eq(shiftTypeTargets.tenantId, ctx.tenantId), eq(shiftTypeTargets.shiftTypeId, cur.id)))
  if (next.length) await tx.insert(shiftTypeTargets).values(next.map((t) => ({ tenantId: ctx.tenantId, shiftTypeId: cur.id, weekday: t.weekday, count: t.count })))
  const [row] = await tx.update(shiftTypes).set({ version: cur.version + 1, updatedAt: ctx.now }).where(and(eq(shiftTypes.id, cur.id), eq(shiftTypes.tenantId, ctx.tenantId))).returning()
  await writeHistory(tx, ctx, { locationId: cur.locationId, action: "targets_changed", before: { shiftTypeId: cur.id, targets: old }, after: { shiftTypeId: cur.id, targets: next } })
  await auditRoster(tx, ctx, { action: "roster.targets_changed", entity: "shift_type", entityId: cur.id, before: { targets: old }, after: { targets: next } })
  return toTypeDto(row, next)
}

// ------------------------------------------------------------------ office limits (FR-RS-04)

/**
 * PUT /v1/roster/office-limits/{userId}: the sites a Roster Manager does NOT manage. Only an office role WITHOUT a limit of its own may change them
 * (a limited manager cannot lift their own cut). The person must be an active member with office level and roster write (422 not_roster_office
 * otherwise); every site must exist in the tenant (422 invalid_location). The next request of that person is cut by the new list.
 */
export async function setOfficeLimit(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, userId: string, except: string[]): Promise<{ userId: string; except: string[] }> {
  const all = (await tx.select({ id: locations.id }).from(locations).where(eq(locations.tenantId, ctx.tenantId))).map((l) => l.id)
  unrestrictedOffice(ctx, all)
  const [m] = await tx
    .select({ status: memberships.status, level: roles.rosterLevel, access: roles.access })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)))
    .for("share", { of: memberships })
  if (!m) throw NotFound("member_not_found")
  const roster = (m.access as Record<string, string>).roster
  if (m.status !== "active" || m.level !== "office" || roster !== "write") throw unprocessable("not_roster_office")
  const next = [...new Set(except)].sort()
  if (next.some((id) => !isUuid(id) || !all.includes(id))) throw unprocessable("invalid_location")
  const old = (await tx.select({ id: rosterOfficeLimits.locationId }).from(rosterOfficeLimits).where(and(eq(rosterOfficeLimits.tenantId, ctx.tenantId), eq(rosterOfficeLimits.userId, userId))).orderBy(asc(rosterOfficeLimits.locationId)).for("update")).map((r) => r.id)
  if (JSON.stringify(old) === JSON.stringify(next)) return { userId, except: next }
  await tx.delete(rosterOfficeLimits).where(and(eq(rosterOfficeLimits.tenantId, ctx.tenantId), eq(rosterOfficeLimits.userId, userId)))
  if (next.length) await tx.insert(rosterOfficeLimits).values(next.map((locationId) => ({ tenantId: ctx.tenantId, userId, locationId })))
  // the person's next request is cut by the new list: tell them (generic text, no site names; nobody is told about their own change)
  if (userId !== ctx.actorId) await notify(tx, ctx.tenantId, { userId, kind: "member", title: "Your roster access changed", body: "The locations you manage were updated.", link: "/rosters" }, env.deps, env.enqueue)
  await auditRoster(tx, ctx, { action: "roster.office_limit_changed", entity: "membership", entityId: userId, before: { except: old }, after: { except: next } })
  return { userId, except: next }
}
