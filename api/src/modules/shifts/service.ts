import { and, asc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm"
import { addDays, epochToWall, isHm, isTimeZone } from "@opsdesk/domain/shifts"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { memberships, reportingLines, roles, shiftAssignments, shiftPatterns, shiftReportingPeople, shiftReportingTeams, teamMembers, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import { canonicalTimezone, reportDueAfterMinutes } from "../settings"
import { assignmentDto, patternDto, validDate, type AssignmentDto, type OccurrenceDto, type PatternDto } from "./dto"
import { publishShiftEvent } from "./events"
import { livePatternsQuery, occurrencesBetween, type AssignmentRow, type PatternRow } from "./occurrences"
import { loadReportingMaps, reportingFrom } from "./reporting"
import { inWriteScope, type ShiftCtx } from "./scope"

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const PatternNotFound = () => NotFound("shift_pattern_not_found")
const AssignmentNotFound = () => NotFound("shift_assignment_not_found")
const TeamNotFound = () => NotFound("team_not_found")
const NotAMember = () => NotFound("not_a_member")

/** How far back GET /v1/shifts returns ended assignments (days before the tenant's today), so a list never grows without bound. */
export const HISTORY_DAYS = 92
/** Longest range GET /v1/shifts/occurrences answers (shift start dates, both ends included). */
export const MAX_RANGE_DATES = 31
const DAY_MS = 86_400_000
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS)
const todayOf = (ctx: Pick<ShiftCtx, "now" | "tz">) => epochToWall(ctx.now.getTime(), ctx.tz).slice(0, 10)

// ------------------------------------------------------------------ read

export type ShiftsDto = {
  patterns: PatternDto[]
  assignments: AssignmentDto[]
  members: { userId: string; teams: string[]; managerId: string | null }[]
  reporting: { dueAfterMinutes: number; teamDefaults: Record<string, boolean>; overrides: Record<string, boolean> }
}

/**
 * GET /v1/shifts: the whole planning bundle (FR-M1-20/21). Managers (and read-only manager-home roles) get every live pattern, the assignments that
 * are open or ended within the last HISTORY_DAYS, every active member with their team ids and primary manager, and the reporting settings. A staff-home
 * reader gets the `ownShiftState` cut, built on the server: their own assignments, the patterns those use, their own row (with THEIR primary manager),
 * their own override, and the team defaults of the teams they belong to or whose pattern they work. No other person's id is in it.
 */
export async function getShifts(tx: TenantTx, ctx: ShiftCtx): Promise<ShiftsDto> {
  const { tenantId } = ctx
  const own = ctx.view === "own"
  const cutoff = addDays(todayOf(ctx), -HISTORY_DAYS)
  const live = await livePatternsQuery(tx, tenantId)
  const aRows = live.length
    ? await tx
        .select()
        .from(shiftAssignments)
        .where(and(eq(shiftAssignments.tenantId, tenantId), inArray(shiftAssignments.patternId, live.map((p) => p.id)), own ? eq(shiftAssignments.userId, ctx.me) : undefined, or(isNull(shiftAssignments.untilDate), gte(shiftAssignments.untilDate, cutoff))))
        .orderBy(asc(shiftAssignments.fromDate), asc(shiftAssignments.id))
    : []
  const usedPatterns = own ? live.filter((p) => aRows.some((a) => a.patternId === p.id)) : live

  const mRows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), own ? eq(memberships.userId, ctx.me) : undefined))
    .orderBy(asc(memberships.userId))
  const tm = await tx.select({ userId: teamMembers.userId, teamId: teamMembers.teamId }).from(teamMembers).where(and(eq(teamMembers.tenantId, tenantId), own ? eq(teamMembers.userId, ctx.me) : undefined)).orderBy(asc(teamMembers.teamId))
  const rl = await tx.select({ userId: reportingLines.userId, managerId: reportingLines.managerId }).from(reportingLines).where(and(eq(reportingLines.tenantId, tenantId), own ? eq(reportingLines.userId, ctx.me) : undefined))
  const members = mRows.map((m) => ({ userId: m.userId, teams: tm.filter((t) => t.userId === m.userId).map((t) => t.teamId), managerId: rl.find((r) => r.userId === m.userId)?.managerId ?? null }))

  const maps = await loadReportingMaps(tx, tenantId)
  const visibleTeams = own ? new Set([...members.flatMap((m) => m.teams), ...usedPatterns.map((p) => p.teamId)]) : null
  const teamDefaults = Object.fromEntries([...maps.teams].filter(([t]) => !visibleTeams || visibleTeams.has(t)))
  const overrides = Object.fromEntries([...maps.people].filter(([u]) => !own || u === ctx.me))
  return { patterns: usedPatterns.map(patternDto), assignments: aRows.map(assignmentDto), members, reporting: { dueAfterMinutes: await reportDueAfterMinutes(tx, tenantId), teamDefaults, overrides } }
}

/** GET /v1/shifts/occurrences: the shifts that START between `from` and `to` (inclusive), each with the effective reporting for the SHIFT'S team. */
export async function listOccurrences(tx: TenantTx, ctx: ShiftCtx, q: { from: string; to: string; userId?: string }): Promise<{ items: OccurrenceDto[] }> {
  if (!validDate(q.from) || !validDate(q.to) || q.from > q.to) throw unprocessable("invalid_range")
  if (dayNum(q.to) - dayNum(q.from) + 1 > MAX_RANGE_DATES) throw unprocessable("range_too_long")
  // staff see their own shifts only: asking for someone else is an empty answer, not an error and not an oracle
  const userIds = ctx.view === "own" ? (q.userId && q.userId !== ctx.me ? [] : [ctx.me]) : q.userId ? [q.userId] : undefined
  const occ = await occurrencesBetween(tx, ctx.tenantId, ctx.tz, q.from, q.to, { userIds })
  const maps = await loadReportingMaps(tx, ctx.tenantId)
  return {
    items: occ.map((o) => {
      const start = epochToWall(o.startAt.getTime(), ctx.tz)
      const end = epochToWall(o.endAt.getTime(), ctx.tz)
      return {
        userId: o.userId, patternId: o.patternId, name: o.name, teamId: o.teamId, shiftDate: o.shiftDate, start, end, startAt: o.startAt.toISOString(), endAt: o.endAt.toISOString(),
        minutes: o.minutes, endsNextDay: end.slice(0, 10) !== start.slice(0, 10), reportsOn: reportingFrom(maps, o.userId, o.teamId),
      }
    }),
  }
}

// ------------------------------------------------------------------ patterns

type PatternInput = { name: string; start: string; end: string; days: number[]; timeZone: string | null }

/** Validates and normalises the fields of a pattern: name (trimmed, 1..80, one line), HH:MM times, 1..7 unique weekdays 0..6 (stored sorted), IANA zone (canonical spelling). */
function checkPattern(v: Partial<{ name: string; start: string; end: string; days: number[]; timeZone: string | null }>): Partial<PatternInput> {
  const out: Partial<PatternInput> = {}
  if (v.name !== undefined) {
    const name = v.name.trim()
    if (name.length < 1 || name.length > 80 || !/^[^\r\n\u0000-\u001f\u007f]+$/.test(name)) throw unprocessable("invalid_pattern")
    out.name = name
  }
  if (v.start !== undefined) {
    if (!isHm(v.start)) throw unprocessable("invalid_pattern")
    out.start = v.start
  }
  if (v.end !== undefined) {
    if (!isHm(v.end)) throw unprocessable("invalid_pattern")
    out.end = v.end
  }
  if (v.days !== undefined) {
    const days = [...new Set(v.days)].sort((a, b) => a - b)
    if (days.length !== v.days.length || days.length < 1 || days.length > 7 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw unprocessable("invalid_pattern")
    out.days = days
  }
  if (v.timeZone !== undefined) {
    if (v.timeZone === null) out.timeZone = null
    else {
      const tz = canonicalTimezone(v.timeZone)
      if (!tz || !isTimeZone(tz)) throw unprocessable("invalid_pattern_zone")
      out.timeZone = tz
    }
  }
  return out
}

/** The team exists in this tenant. FOR SHARE: a concurrent team delete waits for us (then fails the pattern FK: 409 team_has_shifts) or committed first (404 here). */
async function assertTeam(tx: TenantTx, tenantId: string, teamId: string): Promise<void> {
  const [t] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, teamId), eq(teams.tenantId, tenantId))).for("share")
  if (!t) throw TeamNotFound()
}

async function assertNameFree(tx: TenantTx, tenantId: string, teamId: string, name: string, exceptId?: string): Promise<void> {
  const rows = await tx.select({ id: shiftPatterns.id }).from(shiftPatterns).where(and(eq(shiftPatterns.tenantId, tenantId), eq(shiftPatterns.teamId, teamId), eq(shiftPatterns.name, name), isNull(shiftPatterns.archivedAt)))
  if (rows.some((r) => r.id !== exceptId)) throw Conflict("pattern_name_taken")
}

const auditPattern = (p: PatternRow) => ({ name: p.name, teamId: p.teamId, start: p.startTime, end: p.endTime, days: p.days, timeZone: p.timeZone })

/** Pattern create, edit and archive are all-scope managers only (F14): a pattern belongs to a team and a team has no manager. */
function allScopeOnly(ctx: ShiftCtx): void {
  if (ctx.write !== "all") throw Forbidden("forbidden")
}

export async function createPattern(tx: TenantTx, ctx: ShiftCtx, input: { name: string; teamId: string; start: string; end: string; days: number[]; timeZone?: string | null }): Promise<PatternDto> {
  allScopeOnly(ctx)
  const v = checkPattern({ name: input.name, start: input.start, end: input.end, days: input.days, timeZone: input.timeZone ?? null }) as PatternInput
  await assertTeam(tx, ctx.tenantId, input.teamId)
  await assertNameFree(tx, ctx.tenantId, input.teamId, v.name)
  const [row] = await tx
    .insert(shiftPatterns)
    .values({ tenantId: ctx.tenantId, teamId: input.teamId, name: v.name, startTime: v.start, endTime: v.end, days: v.days, timeZone: v.timeZone, createdAt: ctx.now, updatedAt: ctx.now })
    .returning()
  await recordAudit(tx, ctx.tenantId, { action: "shift.pattern_created", entity: "shift_pattern", entityId: row.id, actorId: ctx.actorId, before: null, after: auditPattern(row) }, ctx.now)
  await publishShiftEvent(tx, ctx, { type: "shift.pattern_created", payload: { patternId: row.id } })
  return patternDto(row)
}

/** A live pattern locked FOR UPDATE; an archived, unknown or other-tenant id is the same 404. */
async function lockedPattern(tx: TenantTx, tenantId: string, id: string): Promise<PatternRow> {
  const [row] = await tx.select().from(shiftPatterns).where(and(eq(shiftPatterns.id, id), eq(shiftPatterns.tenantId, tenantId), isNull(shiftPatterns.archivedAt))).for("update")
  if (!row) throw PatternNotFound()
  return row
}

export async function patchPattern(tx: TenantTx, ctx: ShiftCtx, id: string, input: { version: number; name?: string; teamId?: string; start?: string; end?: string; days?: number[]; timeZone?: string | null }): Promise<PatternDto> {
  allScopeOnly(ctx)
  const cur = await lockedPattern(tx, ctx.tenantId, id)
  if (cur.version !== input.version) throw Conflict("version_conflict")
  const v = checkPattern(input)
  const teamId = input.teamId ?? cur.teamId
  if (input.teamId !== undefined && input.teamId !== cur.teamId) await assertTeam(tx, ctx.tenantId, input.teamId)
  const next = {
    name: v.name ?? cur.name, teamId, startTime: v.start ?? cur.startTime, endTime: v.end ?? cur.endTime, days: v.days ?? cur.days, timeZone: v.timeZone !== undefined ? v.timeZone : cur.timeZone,
  }
  const same = next.name === cur.name && next.teamId === cur.teamId && next.startTime === cur.startTime && next.endTime === cur.endTime && next.timeZone === cur.timeZone && JSON.stringify([...next.days].sort()) === JSON.stringify([...cur.days].sort())
  if (same) return patternDto(cur) // nothing changes: no bump, no audit
  if (next.name !== cur.name || next.teamId !== cur.teamId) await assertNameFree(tx, ctx.tenantId, next.teamId, next.name, cur.id)
  const [row] = await tx.update(shiftPatterns).set({ ...next, version: cur.version + 1, updatedAt: ctx.now }).where(and(eq(shiftPatterns.id, cur.id), eq(shiftPatterns.tenantId, ctx.tenantId))).returning()
  await recordAudit(tx, ctx.tenantId, { action: "shift.pattern_updated", entity: "shift_pattern", entityId: row.id, actorId: ctx.actorId, before: auditPattern(cur), after: auditPattern(row) }, ctx.now)
  await publishShiftEvent(tx, ctx, { type: "shift.pattern_updated", payload: { patternId: row.id } })
  return patternDto(row)
}

/** DELETE = archive (F14): no new occurrences or assignments; assignments, reports and history keep their pattern. */
export async function archivePattern(tx: TenantTx, ctx: ShiftCtx, id: string): Promise<void> {
  allScopeOnly(ctx)
  const cur = await lockedPattern(tx, ctx.tenantId, id)
  const [row] = await tx.update(shiftPatterns).set({ archivedAt: ctx.now, version: cur.version + 1, updatedAt: ctx.now }).where(and(eq(shiftPatterns.id, cur.id), eq(shiftPatterns.tenantId, ctx.tenantId))).returning()
  await recordAudit(tx, ctx.tenantId, { action: "shift.pattern_archived", entity: "shift_pattern", entityId: row.id, actorId: ctx.actorId, before: auditPattern(cur), after: { ...auditPattern(row), archived: true } }, ctx.now)
  await publishShiftEvent(tx, ctx, { type: "shift.pattern_archived", payload: { patternId: row.id } })
}

// ------------------------------------------------------------------ assignments

/** The assignee must be an ACTIVE member whose role can read reports or tasks (someone who can file a report or hold shift tasks). */
async function assertAssignee(tx: TenantTx, tenantId: string, userId: string): Promise<void> {
  const [m] = await tx
    .select({ status: memberships.status, access: roles.access })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
  const a = (m?.access ?? {}) as Record<string, string>
  const reads = (k: string) => a[k] === "read" || a[k] === "write"
  if (!m || m.status !== "active" || !(reads("reports") || reads("tasks"))) throw unprocessable("invalid_assignment")
}

/** Refuses a window that overlaps another assignment of the same member and pattern (from/until inclusive, no until = open-ended). Call under the shift lock. */
async function assertNoOverlap(tx: TenantTx, tenantId: string, userId: string, patternId: string, from: string, until: string | null, exceptId?: string): Promise<void> {
  const rows = await tx
    .select({ id: shiftAssignments.id })
    .from(shiftAssignments)
    .where(
      and(
        eq(shiftAssignments.tenantId, tenantId), eq(shiftAssignments.userId, userId), eq(shiftAssignments.patternId, patternId),
        exceptId ? ne(shiftAssignments.id, exceptId) : undefined,
        until ? sql`${shiftAssignments.fromDate} <= ${until}::date` : undefined,
        or(isNull(shiftAssignments.untilDate), sql`${shiftAssignments.untilDate} >= ${from}::date`),
      ),
    )
    .limit(1)
  if (rows.length > 0) throw unprocessable("invalid_assignment")
}

const auditAssignment = (a: AssignmentRow) => ({ userId: a.userId, patternId: a.patternId, from: a.fromDate, until: a.untilDate })

export async function createAssignment(tx: TenantTx, ctx: ShiftCtx, input: { userId: string; patternId: string; from: string; until?: string | null }): Promise<AssignmentDto> {
  const until = input.until ?? null
  if (!validDate(input.from) || (until !== null && (!validDate(until) || until < input.from))) throw unprocessable("invalid_assignment")
  const [p] = await tx.select().from(shiftPatterns).where(and(eq(shiftPatterns.id, input.patternId), eq(shiftPatterns.tenantId, ctx.tenantId))).for("share")
  if (!p) throw PatternNotFound()
  if (p.archivedAt) throw unprocessable("invalid_assignment") // no new assignments to an archived pattern (F14)
  await assertAssignee(tx, ctx.tenantId, input.userId)
  if (!inWriteScope(ctx, input.userId)) throw unprocessable("assignee_out_of_scope")
  await assertNoOverlap(tx, ctx.tenantId, input.userId, p.id, input.from, until)
  const [row] = await tx.insert(shiftAssignments).values({ tenantId: ctx.tenantId, userId: input.userId, patternId: p.id, fromDate: input.from, untilDate: until, createdBy: ctx.actorId, createdAt: ctx.now }).returning()
  await recordAudit(tx, ctx.tenantId, { action: "shift.assigned", entity: "shift_assignment", entityId: row.id, actorId: ctx.actorId, before: null, after: auditAssignment(row) }, ctx.now)
  await publishShiftEvent(tx, ctx, { type: "shift.assigned", payload: { assignmentId: row.id, patternId: row.patternId, userId: row.userId } })
  return assignmentDto(row)
}

/** The assignment locked FOR UPDATE; unknown, another tenant's and one of a member outside the caller's write scope are the same 404. */
async function lockedAssignment(tx: TenantTx, ctx: ShiftCtx, id: string): Promise<AssignmentRow> {
  const [row] = await tx.select().from(shiftAssignments).where(and(eq(shiftAssignments.id, id), eq(shiftAssignments.tenantId, ctx.tenantId))).for("update")
  if (!row || !inWriteScope(ctx, row.userId)) throw AssignmentNotFound()
  return row
}

/** PATCH {until}: the FE "unassign" sets the end date and keeps the history; null re-opens it. */
export async function patchAssignment(tx: TenantTx, ctx: ShiftCtx, id: string, input: { until: string | null }): Promise<AssignmentDto> {
  const cur = await lockedAssignment(tx, ctx, id)
  if (input.until !== null && (!validDate(input.until) || input.until < cur.fromDate)) throw unprocessable("invalid_assignment")
  if (input.until === cur.untilDate) return assignmentDto(cur)
  await assertNoOverlap(tx, ctx.tenantId, cur.userId, cur.patternId, cur.fromDate, input.until, cur.id)
  const [row] = await tx.update(shiftAssignments).set({ untilDate: input.until }).where(and(eq(shiftAssignments.id, cur.id), eq(shiftAssignments.tenantId, ctx.tenantId))).returning()
  await recordAudit(tx, ctx.tenantId, { action: input.until === null ? "shift.assigned" : "shift.unassigned", entity: "shift_assignment", entityId: row.id, actorId: ctx.actorId, before: auditAssignment(cur), after: auditAssignment(row) }, ctx.now)
  await publishShiftEvent(tx, ctx, { type: input.until === null ? "shift.assigned" : "shift.unassigned", payload: { assignmentId: row.id, patternId: row.patternId, userId: row.userId } })
  return assignmentDto(row)
}

/** Only an assignment that has not started (from_date after the tenant's today) is deleted; a started one keeps its history (409 assignment_started: end it with PATCH). */
export async function deleteAssignment(tx: TenantTx, ctx: ShiftCtx, id: string): Promise<void> {
  const cur = await lockedAssignment(tx, ctx, id)
  if (cur.fromDate <= todayOf(ctx)) throw Conflict("assignment_started")
  await tx.delete(shiftAssignments).where(and(eq(shiftAssignments.id, cur.id), eq(shiftAssignments.tenantId, ctx.tenantId)))
  await recordAudit(tx, ctx.tenantId, { action: "shift.unassigned", entity: "shift_assignment", entityId: cur.id, actorId: ctx.actorId, before: auditAssignment(cur), after: null }, ctx.now)
  await publishShiftEvent(tx, ctx, { type: "shift.unassigned", payload: { assignmentId: cur.id, patternId: cur.patternId, userId: cur.userId } })
}

// ------------------------------------------------------------------ reporting settings

/** PUT /v1/shifts/reporting/teams/{teamId}: the team default (all-scope managers only). */
export async function setTeamReporting(tx: TenantTx, ctx: ShiftCtx, teamId: string, on: boolean): Promise<{ teamId: string; on: boolean }> {
  allScopeOnly(ctx)
  await assertTeam(tx, ctx.tenantId, teamId)
  const [prev] = await tx.select({ on: shiftReportingTeams.on }).from(shiftReportingTeams).where(and(eq(shiftReportingTeams.tenantId, ctx.tenantId), eq(shiftReportingTeams.teamId, teamId))).for("update")
  if (prev?.on === on) return { teamId, on }
  await tx
    .insert(shiftReportingTeams)
    .values({ tenantId: ctx.tenantId, teamId, on, updatedBy: ctx.actorId, updatedAt: ctx.now })
    .onConflictDoUpdate({ target: [shiftReportingTeams.tenantId, shiftReportingTeams.teamId], set: { on, updatedBy: ctx.actorId, updatedAt: ctx.now } })
  await recordAudit(tx, ctx.tenantId, { action: "shift.reporting_changed", entity: "shift_reporting_team", entityId: teamId, actorId: ctx.actorId, before: { on: prev?.on ?? null }, after: { on } }, ctx.now)
  await publishShiftEvent(tx, ctx, { type: "shift.reporting_changed", payload: { teamId, userId: null } })
  return { teamId, on }
}

/** PUT /v1/shifts/reporting/people/{userId}: a per-person override; `null` removes it (the person follows the team default again). */
export async function setPersonReporting(tx: TenantTx, ctx: ShiftCtx, userId: string, on: boolean | null): Promise<{ userId: string; on: boolean | null }> {
  const [m] = await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)))
  if (!m) throw NotAMember()
  if (!inWriteScope(ctx, userId)) throw unprocessable("assignee_out_of_scope")
  const [prev] = await tx.select({ on: shiftReportingPeople.on }).from(shiftReportingPeople).where(and(eq(shiftReportingPeople.tenantId, ctx.tenantId), eq(shiftReportingPeople.userId, userId))).for("update")
  if ((prev?.on ?? null) === on) return { userId, on }
  if (on === null) await tx.delete(shiftReportingPeople).where(and(eq(shiftReportingPeople.tenantId, ctx.tenantId), eq(shiftReportingPeople.userId, userId)))
  else
    await tx
      .insert(shiftReportingPeople)
      .values({ tenantId: ctx.tenantId, userId, on, updatedBy: ctx.actorId, updatedAt: ctx.now })
      .onConflictDoUpdate({ target: [shiftReportingPeople.tenantId, shiftReportingPeople.userId], set: { on, updatedBy: ctx.actorId, updatedAt: ctx.now } })
  await recordAudit(tx, ctx.tenantId, { action: "shift.reporting_changed", entity: "shift_reporting_person", entityId: userId, actorId: ctx.actorId, before: { on: prev?.on ?? null }, after: { on } }, ctx.now)
  await publishShiftEvent(tx, ctx, { type: "shift.reporting_changed", payload: { teamId: null, userId } })
  return { userId, on }
}
