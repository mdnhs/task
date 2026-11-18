import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm"
import type { RuleViolation } from "@opsdesk/domain/roster-rules"
import { addDays, hmMinutes, isHm } from "@opsdesk/domain/shifts"
import { AppError, Conflict, NotFound } from "../../core/errors"
import { errorInfo } from "../../core/safe-error"
import { memberQualifications, memberships, rosterShifts, rosterWeeks, shiftTypes } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { ShiftDto } from "./dto"
import { instantSql, shiftInstants } from "./locations"
import { realDate } from "./qualifications"
import { checkWeek, type NewShift } from "./rules"
import { assertLocation, weekEditGate, type RosterCtx } from "./scope"
import { loadWeek, shiftDto, shiftSnap, type LoadedWeek, type ShiftRow } from "./weeks"
import { auditRoster, isUuid, writeHistory, type RosterEnv } from "./write"

const unprocessable = (code: string, extra?: Record<string, unknown>) => new AppError(422, code, "Unprocessable Entity", extra)
type TypeRow = typeof shiftTypes.$inferSelect

const CTRL = /[\u0000-\u001f\u007f]/
const MAX_ENTRIES = 50
const MAX_SHIFTS_PER_REQUEST = 200

// ------------------------------------------------------------------ shared helpers

/** An office role with no cut on what it edits may override a block with a reason; a supervisor never. */
const mayOverride = (ctx: RosterCtx, reason: string | undefined): boolean => ctx.access.scope === "all" && ctx.access.editPublished && !!reason && reason.trim() !== ""

const cleanReason = (reason: string | undefined): string | null => {
  const r = (reason ?? "").trim()
  if (r.length > 500 || CTRL.test(r.replace(/[\r\n\t]/g, " "))) throw unprocessable("invalid_reason")
  return r === "" ? null : r
}

const cleanRole = (v: string): string => {
  const r = v.trim()
  if (r.length < 1 || r.length > 80 || CTRL.test(r)) throw unprocessable("invalid_shift")
  return r
}

/**
 * The one gate every roster shift write passes (never the route, so a new route cannot forget it): who may edit at all (403), the publish lock (R8-8: a supervisor on
 * a published week is 403 roster_locked, an office role needs a reason), and an archived location stays readable but not editable (409). Removing a shift from an archived site is allowed.
 */
function editableWeek(ctx: RosterCtx, loaded: LoadedWeek, reason: string | undefined, o: { allowArchived?: boolean } = {}): void {
  weekEditGate(ctx, { status: loaded.week.status as "draft" | "published" }, reason)
  if (loaded.week.status === "published") throw Conflict("week_published") // office edits of a published week arrive with the publish task
  if (loaded.archived && !o.allowArchived) throw Conflict("location_archived")
}

/** A shift of the caller's reach with its week locked: week FOR UPDATE first, then the shift FOR UPDATE (one id, so no ordering hazard). The check on the unlocked read comes first. */
export async function loadShift(tx: TenantTx, ctx: RosterCtx, id: string): Promise<{ shift: ShiftRow; loaded: LoadedWeek }> {
  if (!isUuid(id)) throw NotFound()
  const [s] = await tx.select().from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, id)))
  if (!s) throw NotFound()
  assertLocation(ctx, s.locationId)
  const loaded = await loadWeek(tx, ctx, s.weekId, true)
  const [shift] = await tx.select().from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, id))).for("update")
  if (!shift) throw NotFound()
  return { shift, loaded }
}

/** What a person must be to be rostered (always 422 `ineligible`, whatever the tenant's rule severities): an active member (`left` otherwise) holding every required qualification, not expired on the shift date. The member rows are locked FOR SHARE so a concurrent deactivation waits. */
async function assertEligible(tx: TenantTx, ctx: RosterCtx, people: { userId: string; date: string; type: TypeRow }[]): Promise<void> {
  if (people.length === 0) return
  const ids = [...new Set(people.map((p) => p.userId))].sort()
  const members = await tx
    .select({ userId: memberships.userId, status: memberships.status })
    .from(memberships)
    .where(and(eq(memberships.tenantId, ctx.tenantId), inArray(memberships.userId, ids)))
    .orderBy(asc(memberships.userId))
    .for("share")
  const quals = await tx
    .select({ userId: memberQualifications.userId, type: memberQualifications.type, expiresOn: memberQualifications.expiresOn })
    .from(memberQualifications)
    .where(and(eq(memberQualifications.tenantId, ctx.tenantId), inArray(memberQualifications.userId, ids)))
  const status = new Map(members.map((m) => [m.userId, m.status]))
  const errors: { userId: string; date: string; reason: "left" | "qualification_missing" | "qualification_expired"; qualification?: string }[] = []
  for (const p of people) {
    if (status.get(p.userId) !== "active") {
      errors.push({ userId: p.userId, date: p.date, reason: "left" }) // a missing member and a deactivated one read the same
      continue
    }
    for (const need of p.type.requires) {
      const held = quals.filter((q) => q.userId === p.userId && q.type.toLowerCase() === need.toLowerCase())
      if (held.length === 0) errors.push({ userId: p.userId, date: p.date, reason: "qualification_missing", qualification: need })
      else if (!held.some((q) => q.expiresOn === null || q.expiresOn >= p.date)) errors.push({ userId: p.userId, date: p.date, reason: "qualification_expired", qualification: need })
    }
  }
  if (errors.length) throw unprocessable("ineligible", { errors })
}

const violationKey = (v: RuleViolation): string => `${v.rule}|${v.shiftId}|${v.personId}|${[...v.otherShiftIds].sort().join(",")}|${v.message}`

/**
 * The rule gate of a change, run INSIDE the roster write (the lock is held, so the other shifts it reads cannot move under it): the week is checked before and after the
 * change and only what the change CAUSED counts. A new block is 422 `rule_blocked` (with the violations) unless an office role gives a reason; a new warning never stops a draft edit
 * and is returned. Returns what the caller must show plus the overridden blocks for history and audit.
 */
async function ruleGate(tx: TenantTx, ctx: RosterCtx, weekId: string, change: { dropShiftIds?: string[]; add: NewShift[] }, reason: string | undefined): Promise<{ violations: RuleViolation[]; overrides: { rule: string; shiftId: string; personId: string }[] }> {
  const before = new Set((await checkWeek(tx, ctx, weekId)).map(violationKey))
  const fresh = (await checkWeek(tx, ctx, weekId, change)).filter((v) => !before.has(violationKey(v)))
  const blocks = fresh.filter((v) => v.severity === "block")
  if (blocks.length > 0 && !mayOverride(ctx, reason)) throw unprocessable("rule_blocked", { violations: fresh })
  return { violations: fresh, overrides: blocks.map((v) => ({ rule: v.rule, shiftId: v.shiftId, personId: v.personId })) }
}

type Spec = { id: string; date: string; userId: string | null; type: TypeRow; role: string; start: string; end: string; unpaidBreakMin: number; startAt: number; endAt: number }

/** Validates the wall values and computes the instants in the location's zone (R8-2; the DST rule is wallToEpoch's). End at or before start is overnight; equal is refused; the break fits inside. */
function instants(date: string, start: string, end: string, unpaidBreakMin: number, zone: string): { startAt: number; endAt: number } {
  if (!isHm(start) || !isHm(end) || hmMinutes(start) === hmMinutes(end)) throw unprocessable("invalid_shift")
  if (!Number.isInteger(unpaidBreakMin) || unpaidBreakMin < 0 || unpaidBreakMin > 480) throw unprocessable("invalid_shift")
  const t = shiftInstants(date, start, end, zone)
  if (t.endAt <= t.startAt || unpaidBreakMin * 60_000 >= t.endAt - t.startAt) throw unprocessable("invalid_shift")
  return t
}

const inWeek = (weekStart: string, date: string): boolean => realDate(date) && date >= weekStart && date <= addDays(weekStart, 6)

/** A foreign-key or unique violation from the database (a location pair the composite FK refuses, a racing duplicate) is a 409, never a 500. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const code = errorInfo(err).code
    if (code === "23503" || code === "23505") throw Conflict("shift_conflict")
    throw err
  }
}

/** The exact same person, date, type and times already on the week (a double click or a retried request): 409 shift_exists. Open shifts may repeat (three guards needed = three rows). */
async function assertNoDuplicate(tx: TenantTx, ctx: RosterCtx, weekId: string, specs: Spec[], exceptId?: string): Promise<void> {
  const assigned = specs.filter((s) => s.userId !== null)
  if (assigned.length === 0) return
  const rows = await tx
    .select({ id: rosterShifts.id, userId: rosterShifts.userId, date: rosterShifts.date, typeId: rosterShifts.shiftTypeId, start: rosterShifts.startTime, end: rosterShifts.endTime })
    .from(rosterShifts)
    .where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.weekId, weekId), inArray(rosterShifts.userId, [...new Set(assigned.map((s) => s.userId!))]), exceptId ? ne(rosterShifts.id, exceptId) : undefined))
  const key = (u: string | null, d: string, t: string, s: string, e: string) => `${u}|${d}|${t}|${s}|${e}`
  const have = new Set(rows.map((r) => key(r.userId, r.date, r.typeId, r.start, r.end)))
  if (assigned.some((s) => have.has(key(s.userId, s.date, s.type.id, s.start, s.end)))) throw Conflict("shift_exists")
}

const bumpWeek = (tx: TenantTx, ctx: RosterCtx, w: { id: string; version: number }) =>
  tx.update(rosterWeeks).set({ version: w.version + 1, updatedAt: ctx.now }).where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.id, w.id)))

// ------------------------------------------------------------------ add (several people at once)

type AddEntry = { date: string; userIds: (string | null)[]; shiftTypeId: string; role?: string; start?: string; end?: string; unpaidBreakMin?: number }

/**
 * POST /v1/roster/weeks/{id}/shifts (FR-RS-20, 22): one entry per date and shift type, one shift per person (null = an open shift). Start, end, break and role default from the shift
 * type and may differ per entry. All or nothing: any ineligible person, bad value or new block fails the whole request and writes nothing. History, audit per shift; no event for a draft.
 */
export async function addShifts(tx: TenantTx, ctx: RosterCtx, _env: RosterEnv, weekId: string, input: { shifts: AddEntry[]; reason?: string }): Promise<{ shifts: ShiftDto[]; violations: RuleViolation[] }> {
  const loaded = await loadWeek(tx, ctx, weekId, true)
  const week = loaded.week
  editableWeek(ctx, loaded, input.reason)
  const reason = cleanReason(input.reason)
  if (input.shifts.length < 1 || input.shifts.length > MAX_ENTRIES) throw unprocessable("invalid_shift")
  const typeIds = [...new Set(input.shifts.map((e) => e.shiftTypeId))]
  if (typeIds.some((t) => !isUuid(t))) throw unprocessable("invalid_shift_type")
  const types = await tx.select().from(shiftTypes).where(and(eq(shiftTypes.tenantId, ctx.tenantId), eq(shiftTypes.locationId, week.locationId), inArray(shiftTypes.id, typeIds)))
  const byId = new Map(types.map((t) => [t.id, t]))
  const specs: Spec[] = []
  for (const e of input.shifts) {
    const type = byId.get(e.shiftTypeId)
    if (!type || type.archivedAt) throw unprocessable("invalid_shift_type") // another site's type, a missing one and an archived one read the same
    if (!inWeek(week.weekStart, e.date) || e.userIds.length < 1 || e.userIds.length > MAX_ENTRIES) throw unprocessable("invalid_shift")
    const named = e.userIds.filter((u): u is string => u !== null)
    if (named.some((u) => u.length < 1) || new Set(named).size !== named.length) throw unprocessable("invalid_shift")
    const start = e.start ?? type.startTime
    const end = e.end ?? type.endTime
    const unpaidBreakMin = e.unpaidBreakMin ?? type.unpaidBreakMin
    const t = instants(e.date, start, end, unpaidBreakMin, loaded.zone)
    for (const userId of e.userIds) specs.push({ id: randomUUID(), date: e.date, userId, type, role: e.role === undefined ? type.role : cleanRole(e.role), start, end, unpaidBreakMin, startAt: t.startAt, endAt: t.endAt })
  }
  if (specs.length > MAX_SHIFTS_PER_REQUEST) throw unprocessable("invalid_shift")
  const seen = new Set<string>()
  for (const s of specs.filter((x) => x.userId !== null)) {
    const k = `${s.userId}|${s.date}|${s.type.id}|${s.start}|${s.end}`
    if (seen.has(k)) throw unprocessable("invalid_shift") // the same person twice in one request
    seen.add(k)
  }
  await assertEligible(tx, ctx, specs.filter((s) => s.userId !== null).map((s) => ({ userId: s.userId!, date: s.date, type: s.type })))
  await assertNoDuplicate(tx, ctx, week.id, specs)
  const gate = await ruleGate(tx, ctx, week.id, { add: specs.map((s) => ({ id: s.id, date: s.date, personId: s.userId, shiftTypeId: s.type.id, start: s.start, end: s.end, unpaidBreakMin: s.unpaidBreakMin })) }, input.reason)
  const rows = await guarded(() =>
    tx
      .insert(rosterShifts)
      .values(specs.map((s) => ({
        id: s.id, tenantId: ctx.tenantId, weekId: week.id, locationId: week.locationId, date: s.date, userId: s.userId, shiftTypeId: s.type.id, role: s.role, startTime: s.start, endTime: s.end,
        unpaidBreakMin: s.unpaidBreakMin, startAt: instantSql(s.startAt) as unknown as Date, endAt: instantSql(s.endAt) as unknown as Date, createdBy: ctx.actorId, createdAt: ctx.now, updatedAt: ctx.now,
      })))
      .returning(),
  )
  const sorted = specs.map((s) => rows.find((r) => r.id === s.id)!)
  await bumpWeek(tx, ctx, week)
  const mine = new Set(sorted.map((r) => r.id))
  for (const [i, r] of sorted.entries()) {
    // an override is recorded on the new shift it concerns; one that concerns a neighbouring shift rides on the first new shift
    const o = gate.overrides.filter((x) => x.shiftId === r.id || (i === 0 && !mine.has(x.shiftId)))
    await writeHistory(tx, ctx, { locationId: week.locationId, weekId: week.id, shiftId: r.id, action: "shift_added", reason, after: { ...shiftSnap(r), ...(o.length ? { overrides: o } : {}) } })
    await auditRoster(tx, ctx, { action: "roster.shift_added", entity: "roster_shift", entityId: r.id, before: null, after: shiftSnap(r) })
  }
  return { shifts: sorted.map(shiftDto), violations: gate.violations }
}

// ------------------------------------------------------------------ move / change

const PATCH_KEYS = ["date", "start", "end", "unpaidBreakMin", "userId", "shiftTypeId", "role"] as const
type Patch = Partial<{ date: string; start: string; end: string; unpaidBreakMin: number; userId: string | null; shiftTypeId: string; role: string }>

/** The whitelisted fields of a patch, typed. A key that would move the shift to another week is 422 cannot_move_week, any other unknown key 422 invalid_patch. */
function parsePatch(raw: Record<string, unknown>): Patch {
  const keys = Object.keys(raw)
  if (keys.some((k) => k === "weekId" || k === "locationId")) throw unprocessable("cannot_move_week")
  if (keys.length === 0 || keys.some((k) => !(PATCH_KEYS as readonly string[]).includes(k))) throw unprocessable("invalid_patch")
  const out: Patch = {}
  const str = (k: string, max: number): string => {
    const v = raw[k]
    if (typeof v !== "string" || v.length < 1 || v.length > max) throw unprocessable("invalid_patch")
    return v
  }
  if ("date" in raw) out.date = str("date", 10)
  if ("start" in raw) out.start = str("start", 10)
  if ("end" in raw) out.end = str("end", 10)
  if ("role" in raw) out.role = cleanRole(str("role", 200))
  if ("shiftTypeId" in raw) out.shiftTypeId = str("shiftTypeId", 64)
  if ("userId" in raw) out.userId = raw.userId === null ? null : str("userId", 128)
  if ("unpaidBreakMin" in raw) {
    if (typeof raw.unpaidBreakMin !== "number") throw unprocessable("invalid_patch")
    out.unpaidBreakMin = raw.unpaidBreakMin
  }
  return out
}

/**
 * PATCH /v1/roster/shifts/{id} (`{ version, patch, reason? }`): move, retime, reassign, retype or re-role one shift inside its week. A stale version is 409 version_conflict; a date outside the
 * week is 422 cannot_move_week; a new person or type or date re-runs eligibility (422 ineligible); a block the change causes is 422 rule_blocked unless an office role gives a reason.
 * A patch that changes nothing writes nothing. Changing the type copies the new type's times, break and role unless the patch gives them.
 */
export async function patchShift(tx: TenantTx, ctx: RosterCtx, _env: RosterEnv, id: string, input: { version: number; patch: Record<string, unknown>; reason?: string }): Promise<{ shift: ShiftDto; violations: RuleViolation[] }> {
  const { shift: cur, loaded } = await loadShift(tx, ctx, id)
  const week = loaded.week
  editableWeek(ctx, loaded, input.reason)
  if (cur.version !== input.version) throw Conflict("version_conflict")
  const reason = cleanReason(input.reason)
  const p = parsePatch(input.patch)
  if (p.date !== undefined && !inWeek(week.weekStart, p.date)) throw unprocessable(realDate(p.date) ? "cannot_move_week" : "invalid_patch")
  const typeChanged = p.shiftTypeId !== undefined && p.shiftTypeId !== cur.shiftTypeId
  let type: TypeRow | undefined
  if (p.shiftTypeId !== undefined) {
    if (!isUuid(p.shiftTypeId)) throw unprocessable("invalid_shift_type")
    ;[type] = await tx.select().from(shiftTypes).where(and(eq(shiftTypes.tenantId, ctx.tenantId), eq(shiftTypes.locationId, week.locationId), eq(shiftTypes.id, p.shiftTypeId)))
    if (!type || (typeChanged && type.archivedAt)) throw unprocessable("invalid_shift_type")
  } else {
    ;[type] = await tx.select().from(shiftTypes).where(and(eq(shiftTypes.tenantId, ctx.tenantId), eq(shiftTypes.id, cur.shiftTypeId)))
  }
  const t = type!
  const next = {
    date: p.date ?? cur.date,
    userId: "userId" in p ? p.userId! : cur.userId,
    shiftTypeId: t.id,
    role: p.role ?? (typeChanged ? t.role : cur.role),
    start: p.start ?? (typeChanged ? t.startTime : cur.startTime),
    end: p.end ?? (typeChanged ? t.endTime : cur.endTime),
    unpaidBreakMin: p.unpaidBreakMin ?? (typeChanged ? t.unpaidBreakMin : cur.unpaidBreakMin),
  }
  const inst = instants(next.date, next.start, next.end, next.unpaidBreakMin, loaded.zone)
  const same = next.date === cur.date && next.userId === cur.userId && next.shiftTypeId === cur.shiftTypeId && next.role === cur.role && next.start === cur.startTime && next.end === cur.endTime && next.unpaidBreakMin === cur.unpaidBreakMin
  if (same) return { shift: shiftDto(cur), violations: [] } // nothing changes: no bump, no history, no audit
  if (loaded.archived) throw Conflict("location_archived")
  const spec: Spec = { id: cur.id, date: next.date, userId: next.userId, type: t, role: next.role, start: next.start, end: next.end, unpaidBreakMin: next.unpaidBreakMin, startAt: inst.startAt, endAt: inst.endAt }
  if (next.userId !== null && (next.userId !== cur.userId || typeChanged || next.date !== cur.date)) await assertEligible(tx, ctx, [{ userId: next.userId, date: next.date, type: t }])
  await assertNoDuplicate(tx, ctx, week.id, [spec], cur.id)
  const gate = await ruleGate(tx, ctx, week.id, { dropShiftIds: [cur.id], add: [{ id: cur.id, date: next.date, personId: next.userId, shiftTypeId: t.id, start: next.start, end: next.end, unpaidBreakMin: next.unpaidBreakMin }] }, input.reason)
  const [row] = await guarded(() =>
    tx
      .update(rosterShifts)
      .set({
        date: next.date, userId: next.userId, shiftTypeId: next.shiftTypeId, role: next.role, startTime: next.start, endTime: next.end, unpaidBreakMin: next.unpaidBreakMin,
        startAt: instantSql(inst.startAt) as unknown as Date, endAt: instantSql(inst.endAt) as unknown as Date, version: sql`${rosterShifts.version} + 1`, updatedAt: ctx.now,
      })
      .where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, cur.id)))
      .returning(),
  )
  await bumpWeek(tx, ctx, week)
  await writeHistory(tx, ctx, {
    locationId: week.locationId, weekId: week.id, shiftId: cur.id, action: "shift_moved", reason, before: shiftSnap(cur),
    after: { ...shiftSnap(row), ...(gate.overrides.length ? { overrides: gate.overrides } : {}) },
  })
  await auditRoster(tx, ctx, { action: "roster.shift_moved", entity: "roster_shift", entityId: cur.id, before: shiftSnap(cur), after: shiftSnap(row) })
  return { shift: shiftDto(row), violations: gate.violations }
}

// ------------------------------------------------------------------ remove

/** DELETE /v1/roster/shifts/{id}[?version=&reason=]: removes the shift; history keeps the whole shift as `before`. An archived site's shifts may still be removed. */
export async function deleteShift(tx: TenantTx, ctx: RosterCtx, _env: RosterEnv, id: string, o: { version?: string; reason?: string }): Promise<void> {
  const { shift: cur, loaded } = await loadShift(tx, ctx, id)
  editableWeek(ctx, loaded, o.reason, { allowArchived: true })
  if (o.version !== undefined && (!/^\d{1,9}$/.test(o.version) || Number(o.version) !== cur.version)) throw Conflict("version_conflict")
  const reason = cleanReason(o.reason)
  await tx.delete(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, cur.id)))
  await bumpWeek(tx, ctx, loaded.week)
  await writeHistory(tx, ctx, { locationId: loaded.week.locationId, weekId: loaded.week.id, shiftId: cur.id, action: "shift_removed", reason, before: shiftSnap(cur), after: null })
  await auditRoster(tx, ctx, { action: "roster.shift_removed", entity: "roster_shift", entityId: cur.id, before: shiftSnap(cur), after: null })
}
