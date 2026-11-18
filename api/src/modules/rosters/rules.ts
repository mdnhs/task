import { createHash } from "node:crypto"
import { and, asc, between, eq, gte, inArray, lte, or, sql } from "drizzle-orm"
import { alias, QueryBuilder } from "drizzle-orm/pg-core"
import type { WorkforceMember } from "@opsdesk/domain/contracts"
import { can } from "@opsdesk/domain/permissions"
import { seesAllLocations } from "@opsdesk/domain/roster-access"
import { checkShifts, RULE_IDS, type Availability, type LeaveRequest, type RuleContext, type RuleId, type RuleSeverity, type RuleViolation } from "@opsdesk/domain/roster-rules"
import type { RosterShift, ShiftTemplate } from "@opsdesk/domain/rosters"
import { addDays, epochToWall, weekStart, type Weekday } from "@opsdesk/domain/shifts"
import { AppError, Forbidden, NotFound } from "../../core/errors"
import { leaveRequests, locations, memberships, publicHolidays, rosterAvailability, rosterShifts, rosterWeeks, shiftTypes, user } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { ifMatchHolds, readSetting, writeSetting } from "../settings"
import { assertLocation, canSeePerson, type RosterCtx } from "./scope"
import { auditRoster, isUuid } from "./write"

// The server rule engine (FR-RS-44, D9). The rules themselves are the pure `checkShifts` of packages/domain (the web mock runs the same code): this file loads the
// context from the database, applies the tenant's severities and the caller's visibility, and never decides a rule. A hidden site's shifts of the same person COUNT
// (double booking, rest, weekly hours) but the domain reports them without site, time or shift id.

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")

/** Setting key of the tenant's rule severities and averaging window. */
export const RULES_SETTING = "roster.rules"
/** What a tenant that never changed the setting gets: only a double booking and approved leave stop a publish. The legal minimums themselves live in the domain. */
export const DEFAULT_SEVERITY: Record<RuleId, RuleSeverity> = {
  double_booking: "block", approved_leave: "block", unavailable: "warn", daily_rest: "warn", weekly_rest: "warn", avg_48h: "warn", expired_licence: "warn", left: "warn",
}
/** The reference period of the 48-hour average when the tenant set none (17 weeks, the Working Time Act default). */
export const DEFAULT_AVG_WEEKS = 17
const MAX_AVG_WEEKS = 52
const SEVERITIES: readonly string[] = ["block", "warn", "ignore"]
/** The statutory rules (11 h daily rest, 24 h weekly rest, the 48 h average): a tenant may make them warn or block, never switch them off (AD5). */
export const STATUTORY_RULES: readonly RuleId[] = ["daily_rest", "weekly_rest", "avg_48h"]
const allowed = (rule: RuleId, s: string): boolean => SEVERITIES.includes(s) && !(s === "ignore" && STATUTORY_RULES.includes(rule))

export type RuleSettings = { severity: Record<RuleId, RuleSeverity>; avgWeekReferenceWeeks: number }

const isWeeks = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_AVG_WEEKS

/** The tenant's setting over the defaults. A stored value that is damaged or names a rule this version does not know falls back per field, never fails a check. */
export async function readRules(tx: TenantTx, tenantId: string): Promise<RuleSettings> {
  const v = (await readSetting(tx, tenantId, RULES_SETTING)) as { severity?: Record<string, unknown>; avgWeekReferenceWeeks?: unknown } | undefined
  const severity = { ...DEFAULT_SEVERITY }
  for (const r of RULE_IDS) {
    const s = v?.severity?.[r]
    if (typeof s === "string" && SEVERITIES.includes(s)) severity[r] = (s === "ignore" && STATUTORY_RULES.includes(r) ? "warn" : s) as RuleSeverity // a stored ignore on a statutory rule reads as warn
  }
  return { severity, avgWeekReferenceWeeks: isWeeks(v?.avgWeekReferenceWeeks) ? v.avgWeekReferenceWeeks : DEFAULT_AVG_WEEKS }
}

/** The strong ETag of the settings the engine reads (normalised, fixed key order), so a stored value that normalises to the same reading has the same tag. */
export const rulesEtag = (r: RuleSettings): string =>
  `"${createHash("sha256").update(JSON.stringify({ severity: RULE_IDS.map((id) => [id, r.severity[id]]), avgWeekReferenceWeeks: r.avgWeekReferenceWeeks })).digest("hex").slice(0, 32)}"`

/**
 * PUT /v1/roster/rules (admin or owner: roster write AND settings write), with If-Match (428 without it, a stale one is 412, both decided under the roster lock). PATCH-like: a rule or the window left out KEEPS its stored value. Severity per rule is block | warn | ignore, except the statutory rules (daily_rest, weekly_rest,
 * avg_48h), which take only warn | block. An unknown rule id or a bad severity is 422 invalid_rules, a bad window 422 invalid_avg_weeks (1..52). An unchanged set writes nothing.
 */
export async function putRules(tx: TenantTx, ctx: RosterCtx, input: { severity: Record<string, string>; avgWeekReferenceWeeks?: number }, ifMatch: string | undefined): Promise<RuleSettings> {
  if (!can(ctx.role, "settings", "write")) throw Forbidden("forbidden") // the permission first: a caller who may not change the rules learns nothing about preconditions
  if (!ifMatch) throw new AppError(428, "precondition_required", "Precondition Required")
  const old = await readRules(tx, ctx.tenantId)
  const current = rulesEtag(old)
  if (!ifMatchHolds(ifMatch, current)) throw new AppError(412, "precondition_failed", "Precondition Failed", undefined, { ETag: current })
  const severity = { ...old.severity }
  for (const [rule, s] of Object.entries(input.severity)) {
    if (!(RULE_IDS as readonly string[]).includes(rule) || !allowed(rule as RuleId, s)) throw unprocessable("invalid_rules")
    severity[rule as RuleId] = s as RuleSeverity
  }
  if (input.avgWeekReferenceWeeks !== undefined && !isWeeks(input.avgWeekReferenceWeeks)) throw unprocessable("invalid_avg_weeks")
  const next: RuleSettings = { severity, avgWeekReferenceWeeks: input.avgWeekReferenceWeeks ?? old.avgWeekReferenceWeeks }
  if (JSON.stringify(old) === JSON.stringify(next)) return old
  await writeSetting(tx, ctx.tenantId, RULES_SETTING, next)
  await auditRoster(tx, ctx, { action: "roster.rules_changed", entity: "roster_rules", entityId: ctx.tenantId, before: old, after: next })
  return next
}

/** What the engine runs on, plus the tenant's public holidays in the window (an information line for repeat, never a violation). */
export type LoadedRuleContext = RuleContext & { holidays: { date: string; name: string }[]; /** People the caller may not know anything about (a cross-site loan): named "Member" and reported generically. */ opaque: Set<string> }

type LoadOpts = {
  /** The weeks being checked: their people are the people whose other shifts (at every site) are loaded. */
  weekIds?: string[]
  /** People to load besides those of `weekIds` (a proposed assignment). With neither, every assigned person in the window. */
  personIds?: string[]
  /** The dates being checked. The loader widens it by the averaging window and a rest margin itself, so a caller cannot forget either. */
  from: string
  to: string
}

/** A rest check looks at the neighbours of a shift; a weekly-rest window is 7 days either side, an overnight shift started the day before. */
const MARGIN_DAYS = 8

/**
 * Loads everything `checkShifts` needs in at most 6 queries (settings, shifts with their type and site zone, members with their qualifications, approved leave, availability,
 * public holidays), however many shifts. It reads ALL locations of the tenant, so a hidden site's shifts still produce double-booking and rest violations; the caller's
 * scope only sets `visibleLocationIds` (null when the caller sees every site), which the domain uses to mask.
 */
export async function loadRuleContext(tx: TenantTx, ctx: RosterCtx, opts: LoadOpts): Promise<LoadedRuleContext> {
  const { tenantId } = ctx
  const rules = await readRules(tx, tenantId)
  const from = addDays(weekStart(opts.from), -Math.max(0, rules.avgWeekReferenceWeeks - 1) * 7 - MARGIN_DAYS)
  const to = addDays(opts.to, MARGIN_DAYS)

  const weeks = opts.weekIds ?? []
  const people = opts.personIds ?? []
  const ws = alias(rosterShifts, "ws") // the people of the weeks are a SUBQUERY of the one shifts statement, not a round trip
  const scoped = weeks.length > 0 || people.length > 0
  const who = or(
    weeks.length ? inArray(rosterShifts.userId, new QueryBuilder().select({ u: ws.userId }).from(ws).where(and(eq(ws.tenantId, tenantId), inArray(ws.weekId, weeks), sql`${ws.userId} is not null`))) : undefined,
    people.length ? inArray(rosterShifts.userId, people) : undefined,
  )
  const rows = await tx
    .select({
      id: rosterShifts.id, weekId: rosterShifts.weekId, locationId: rosterShifts.locationId, date: rosterShifts.date, userId: rosterShifts.userId, typeId: rosterShifts.shiftTypeId,
      role: rosterShifts.role, start: rosterShifts.startTime, end: rosterShifts.endTime, unpaidBreakMin: rosterShifts.unpaidBreakMin, confirmedAt: rosterShifts.confirmedAt,
      typeName: shiftTypes.name, typeStart: shiftTypes.startTime, typeEnd: shiftTypes.endTime, typeBreak: shiftTypes.unpaidBreakMin, typeRole: shiftTypes.role, requires: shiftTypes.requires,
      zone: locations.timeZone,
    })
    .from(rosterShifts)
    .innerJoin(shiftTypes, and(eq(shiftTypes.tenantId, rosterShifts.tenantId), eq(shiftTypes.id, rosterShifts.shiftTypeId)))
    .innerJoin(locations, and(eq(locations.tenantId, rosterShifts.tenantId), eq(locations.id, rosterShifts.locationId)))
    .where(
      and(
        eq(rosterShifts.tenantId, tenantId),
        sql`${rosterShifts.userId} is not null`,
        scoped ? or(and(between(rosterShifts.date, from, to), who), weeks.length ? inArray(rosterShifts.weekId, weeks) : undefined) : between(rosterShifts.date, from, to),
      ),
    )
    .orderBy(asc(rosterShifts.date), asc(rosterShifts.startTime), asc(rosterShifts.id))

  const shifts: RosterShift[] = rows.map((r) => ({
    id: r.id, weekId: r.weekId, locationId: r.locationId, date: r.date, personId: r.userId, templateId: r.typeId, role: r.role, start: r.start, end: r.end,
    unpaidBreakMin: r.unpaidBreakMin, confirmedAt: r.confirmedAt?.toISOString() ?? null,
  }))
  const templates = new Map<string, ShiftTemplate>()
  const zones: Record<string, string> = {}
  for (const r of rows) {
    zones[r.locationId] = r.zone ?? ctx.tz
    if (!templates.has(r.typeId)) templates.set(r.typeId, { id: r.typeId, locationId: r.locationId, name: r.typeName, start: r.typeStart, end: r.typeEnd, unpaidBreakMin: r.typeBreak, role: r.typeRole, requires: r.requires })
  }
  const persons = [...new Set([...rows.map((r) => r.userId!), ...people])]

  let members: WorkforceMember[] = []
  const opaque = new Set<string>()
  let leave: LeaveRequest[] = []
  let availability: Availability[] = []
  if (persons.length > 0) {
    const m = await tx
      .select({
        userId: memberships.userId, name: user.name, erasedAt: user.erasedAt, home: memberships.homeLocationId, deactivatedAt: memberships.deactivatedAt,
        quals: sql<{ type: string; expires: string | null }[]>`coalesce((select json_agg(json_build_object('type', q.type, 'expires', q.expires_on) order by q.type) from member_qualifications q where q.tenant_id = ${memberships.tenantId} and q.user_id = ${memberships.userId}), '[]'::json)`,
      })
      .from(memberships)
      .innerJoin(user, eq(user.id, memberships.userId))
      .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.userId, persons)))
      .orderBy(asc(memberships.userId))
    const masked = !seesAllLocations(ctx.access, ctx.allLocationIds)
    for (const r of m) if (masked && !canSeePerson(ctx, r.userId, r.home)) opaque.add(r.userId)
    members = m.map((r) => ({
      id: r.userId, name: opaque.has(r.userId) ? "Member" : r.erasedAt ? "Erased user" : r.name, role: "", dept: "", homeLocationId: r.home, qualifications: r.quals,
      leftOn: r.deactivatedAt ? epochToWall(r.deactivatedAt.getTime(), ctx.tz).slice(0, 10) : null,
    }))
    const l = await tx
      .select()
      .from(leaveRequests)
      .where(and(eq(leaveRequests.tenantId, tenantId), inArray(leaveRequests.userId, persons), eq(leaveRequests.status, "approved"), lte(leaveRequests.fromDate, to), gte(leaveRequests.toDate, from)))
      .orderBy(asc(leaveRequests.fromDate), asc(leaveRequests.id))
    leave = l.map((r) => ({ id: r.id, personId: r.userId, from: r.fromDate, to: r.toDate, kind: r.kind, status: "approved" as const, decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null }))
    const a = await tx
      .select({ userId: rosterAvailability.userId, weekday: rosterAvailability.weekday, from: rosterAvailability.fromTime, to: rosterAvailability.toTime })
      .from(rosterAvailability)
      .where(and(eq(rosterAvailability.tenantId, tenantId), inArray(rosterAvailability.userId, persons)))
      .orderBy(asc(rosterAvailability.userId), asc(rosterAvailability.weekday), asc(rosterAvailability.fromTime))
    availability = a.map((r) => ({ personId: r.userId, weekday: r.weekday as Weekday, from: r.from, to: r.to }))
  }
  const holidays = await tx
    .select({ date: publicHolidays.date, name: publicHolidays.name })
    .from(publicHolidays)
    .where(and(eq(publicHolidays.tenantId, tenantId), between(publicHolidays.date, opts.from, opts.to)))
    .orderBy(asc(publicHolidays.date))

  return {
    shifts, members, leave, availability, templates: [...templates.values()], severity: rules.severity, avgWeekReferenceWeeks: rules.avgWeekReferenceWeeks, tz: ctx.tz, zones,
    visibleLocationIds: seesAllLocations(ctx.access, ctx.allLocationIds) ? null : (ctx.access.locationIds ?? []),
    holidays, opaque,
  }
}

/** A shift being proposed (a dry run): its type fills in the times and the break unless given. */
export type NewShift = { id?: string; date: string; personId: string | null; shiftTypeId: string; start?: string; end?: string; unpaidBreakMin?: number }

/**
 * The rule violations on the people's shifts in one week, as the caller may see them. `extra` simulates a change without writing it: shifts to leave out, shifts to add.
 * A week the caller may not see is the same plain 404 as a missing one or an id that is not a uuid. Reads only: no history, no audit, no event.
 */
export async function checkWeek(tx: TenantTx, ctx: RosterCtx, weekId: string, extra: { dropShiftIds?: string[]; add?: NewShift[] } = {}): Promise<RuleViolation[]> {
  if (!isUuid(weekId)) throw NotFound()
  const [week] = await tx
    .select({ id: rosterWeeks.id, locationId: rosterWeeks.locationId, weekStart: rosterWeeks.weekStart, zone: locations.timeZone })
    .from(rosterWeeks)
    .innerJoin(locations, and(eq(locations.tenantId, rosterWeeks.tenantId), eq(locations.id, rosterWeeks.locationId)))
    .where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.id, weekId)))
  if (!week) throw NotFound()
  assertLocation(ctx, week.locationId)
  const add = (extra.add ?? []).filter((n) => n.personId !== null)
  const c = await loadRuleContext(tx, ctx, { weekIds: [weekId], personIds: add.map((n) => n.personId!), from: week.weekStart, to: addDays(week.weekStart, 6) })
  const drop = new Set(extra.dropShiftIds ?? [])
  const shifts = c.shifts.filter((s) => !drop.has(s.id))
  const templates = [...c.templates]
  const proposed: RosterShift[] = []
  if (add.length > 0) {
    const types = await tx
      .select()
      .from(shiftTypes)
      .where(and(eq(shiftTypes.tenantId, ctx.tenantId), eq(shiftTypes.locationId, week.locationId), inArray(shiftTypes.id, [...new Set(add.map((n) => n.shiftTypeId))])))
    const byId = new Map(types.map((t) => [t.id, t]))
    add.forEach((n, i) => {
      const t = byId.get(n.shiftTypeId)
      if (!t) throw unprocessable("invalid_shift_type")
      if (!templates.some((x) => x.id === t.id)) templates.push({ id: t.id, locationId: t.locationId, name: t.name, start: t.startTime, end: t.endTime, unpaidBreakMin: t.unpaidBreakMin, role: t.role, requires: t.requires })
      proposed.push({ id: n.id ?? `new:${i}`, weekId, locationId: week.locationId, date: n.date, personId: n.personId, templateId: t.id, role: t.role, start: n.start ?? t.startTime, end: n.end ?? t.endTime, unpaidBreakMin: n.unpaidBreakMin ?? t.unpaidBreakMin, confirmedAt: null })
    })
  }
  const all = [...shifts, ...proposed]
  const target = all.filter((s) => s.weekId === weekId && s.personId).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start < b.start ? -1 : a.start > b.start ? 1 : a.id < b.id ? -1 : 1))
  return genericFor(c.opaque, checkShifts(target, { ...c, shifts: all, templates, zones: { ...c.zones, [week.locationId]: week.zone ?? ctx.tz } }))
}

const HIDDEN_LINE = "Already rostered elsewhere"
/** What says something private about a person: their leave, availability, qualifications, departure and shifts elsewhere. For a person the caller cannot see (a cross-site loan) all of it is ONE generic line per shift. */
const PRIVATE_RULES: readonly string[] = ["approved_leave", "unavailable", "expired_licence", "left", "elsewhere"]
function genericFor(opaque: Set<string>, found: RuleViolation[]): RuleViolation[] {
  if (opaque.size === 0) return found
  const out: RuleViolation[] = []
  const at = new Map<string, number>()
  for (const v of found) {
    if (!opaque.has(v.personId) || !PRIVATE_RULES.includes(v.rule)) {
      out.push(v)
      continue
    }
    const key = `${v.shiftId}|${v.personId}`
    const i = at.get(key)
    if (i === undefined) {
      at.set(key, out.length)
      out.push({ rule: "elsewhere", shiftId: v.shiftId, personId: v.personId, severity: v.severity, message: HIDDEN_LINE, otherShiftIds: [] })
    } else if (v.severity === "block") out[i] = { ...out[i], severity: "block" }
  }
  return out
}
