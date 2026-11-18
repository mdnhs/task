import { randomUUID } from "node:crypto"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { applyWeekTemplate, repeatWeek as domainRepeat, type Eligibility, type RepeatConflict, type RepeatResult, type WeekTemplate, type WeekTemplateShift } from "@opsdesk/domain/roster-repeat"
import type { RosterShift, RosterWeek, ShiftTemplate } from "@opsdesk/domain/rosters"
import { addDays, weekdayOf } from "@opsdesk/domain/shifts"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { locations, rosterHistory, rosterShifts, rosterWeeks, rosterWeekTemplates, shiftTypes } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { ApplyTemplateDto, RepeatDto, TemplateDto, WeekDto } from "./dto"
import { instantSql, shiftInstants } from "./locations"
import { realDate } from "./qualifications"
import { HIDDEN_LINE, loadRuleContext, PRIVATE_RULES, type LoadedRuleContext } from "./rules"
import { assertLocation, inScopeSql, type RosterCtx } from "./scope"
import { loadWeek, shiftSnap, weekDtos, type ShiftRow, type WeekRow } from "./weeks"
import { auditRoster, isUuid, officeOnly, writeHistory } from "./write"

// Repeat a published week, saved week templates and the auto-repeat setting (B8 Task 13; FR-RS-22, 26..29, R8-12). Everything here writes DRAFT weeks only: a copy is never published
// by the repeat, never notifies anybody (a draft edit tells nobody, R8-17) and never overwrites a published week. The rule check of every copied shift is the domain `repeatWeek` /
// `applyWeekTemplate` run over the context `loadRuleContext` reads INSIDE the roster write (the lock is held, nothing can move between the check and the insert); the wall time of every
// copy is kept and its instants come from `wallToEpoch` in the LOCATION zone, so a repeat across a clock change keeps 08:00 at 08:00.

const unprocessable = (code: string, extra?: Record<string, unknown>) => new AppError(422, code, "Unprocessable Entity", extra)
const dayMs = 86_400_000
const dayDiff = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs)
const isMonday = (d: string): boolean => realDate(d) && weekdayOf(d) === 1

/** Most weeks one repeat may create (FR-RS-26 "a chosen number of following weeks"). */
export const MAX_REPEAT_WEEKS = 12
/** Most saved templates per location (the list is not paged). */
export const MAX_TEMPLATES = 50

const domainWeek = (w: WeekRow): RosterWeek => ({ id: w.id, locationId: w.locationId, weekStart: w.weekStart, status: w.status as "draft" | "published", publishedAt: null, publishedBy: null, autoRepeatDays: w.autoRepeatDays })
const domainShift = (s: ShiftRow): RosterShift => ({ id: s.id, weekId: s.weekId, locationId: s.locationId, date: s.date, personId: s.userId, templateId: s.shiftTypeId, role: s.role, start: s.startTime, end: s.endTime, unpaidBreakMin: s.unpaidBreakMin, confirmedAt: null })

/**
 * Who may not work a copied shift at all, whatever the tenant's rule severities (eligibility is never a setting, as for an edit): a person who left or is gone, one who lacks a required
 * qualification or whose licence is out of date on the shift's date, and (a template at another site) one who is not on the target site's team. A person the caller may not know (a
 * cross-site loan) is answered with the ONE generic line and reason `elsewhere`: no leave, no qualification, no departure.
 */
export function eligibilityOf(rc: Pick<LoadedRuleContext, "members" | "templates" | "opaque">, o: { homeLocationId?: string } = {}): Eligibility {
  const members = new Map(rc.members.map((m) => [m.id, m]))
  const types = new Map(rc.templates.map((t) => [t.id, t]))
  return (personId, date, typeId) => {
    const m = members.get(personId)
    const no = (reason: RepeatConflict["reason"], message: string) => (rc.opaque.has(personId) ? { reason: "elsewhere" as const, message: HIDDEN_LINE } : { reason, message })
    if (!m || m.leftOn !== null) return no("left", `Left before ${date}`)
    if (o.homeLocationId !== undefined && m.homeLocationId !== o.homeLocationId) return { reason: "not_in_location", message: `Not on this location's team on ${date}` }
    for (const need of types.get(typeId)?.requires ?? []) {
      const held = m.qualifications.filter((q) => q.type.toLowerCase() === need.toLowerCase())
      if (held.length === 0) return no("qualification_missing", `Missing ${need} on ${date}`)
      if (!held.some((q) => q.expires === null || q.expires >= date)) return no("expired_licence", `${need} expired before ${date}`)
    }
    return null
  }
}

/** A conflict as the caller may read it: what says something private about a person the caller may not know is the one generic line. */
function generic(c: RepeatConflict, opaque: Set<string>): RepeatConflict {
  return opaque.has(c.personId) && PRIVATE_RULES.includes(c.reason) ? { ...c, reason: "elsewhere", message: HIDDEN_LINE } : c
}

type Counts = RepeatDto["counts"]
const countOf = (shifts: RosterShift[], conflicts: RepeatConflict[]): Counts => {
  const opened = conflicts.filter((c) => c.open).length
  const warned = conflicts.filter((c) => !c.open).length
  return { copied: shifts.length, kept: shifts.length - opened - warned, warned, opened }
}
const addCounts = (a: Counts, b: Counts): Counts => ({ copied: a.copied + b.copied, kept: a.kept + b.kept, warned: a.warned + b.warned, opened: a.opened + b.opened })
const ZERO: Counts = { copied: 0, kept: 0, warned: 0, opened: 0 }

/**
 * Writes one result of the domain as a draft week: the week row (new, or the existing draft whose shifts are replaced, each removed shift kept whole in history), then the shifts with
 * their instants. Returns the week row. Rows are locked FOR UPDATE in id order before anything is deleted.
 */
async function persist(tx: TenantTx, ctx: RosterCtx, zone: string, res: RepeatResult, existing: WeekRow | null, sourceIds: (string | null)[]): Promise<WeekRow> {
  let week: WeekRow
  if (existing) {
    const old = await tx.select().from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.weekId, existing.id))).orderBy(asc(rosterShifts.id)).for("update")
    if (old.length > 0) {
      await tx.insert(rosterHistory).values(old.map((s) => ({ tenantId: ctx.tenantId, locationId: s.locationId, weekId: s.weekId, shiftId: s.id, action: "shift_removed", actorId: ctx.actorId, reason: null, before: shiftSnap(s) as Record<string, unknown>, after: null, createdAt: ctx.now })))
      await tx.delete(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.weekId, existing.id)))
    }
    ;[week] = await tx.update(rosterWeeks).set({ version: existing.version + 1, updatedAt: ctx.now }).where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.id, existing.id))).returning()
  } else {
    ;[week] = await tx.insert(rosterWeeks).values({ id: res.week.id, tenantId: ctx.tenantId, locationId: res.week.locationId, weekStart: res.week.weekStart, autoRepeatDays: res.week.autoRepeatDays, createdAt: ctx.now, updatedAt: ctx.now }).returning()
  }
  if (res.shifts.length > 0) {
    await tx.insert(rosterShifts).values(
      res.shifts.map((s, i) => {
        const t = shiftInstants(s.date, s.start, s.end, zone)
        return {
          id: s.id, tenantId: ctx.tenantId, weekId: week.id, locationId: week.locationId, date: s.date, userId: s.personId, shiftTypeId: s.templateId, role: s.role, startTime: s.start, endTime: s.end,
          unpaidBreakMin: s.unpaidBreakMin, startAt: instantSql(t.startAt), endAt: instantSql(t.endAt), confirmedAt: null, sourceShiftId: sourceIds[i] ?? null, createdBy: ctx.actorId, createdAt: ctx.now, updatedAt: ctx.now,
        }
      }),
    )
  }
  return week
}

/** The conflict list of one written week as the API shows it (date from its shift, generic for people the caller may not know). */
const conflictDtos = (weekId: string, res: RepeatResult, opaque: Set<string>): RepeatDto["conflicts"] => {
  const date = new Map(res.shifts.map((s) => [s.id, s.date]))
  return res.conflicts.map((c) => generic(c, opaque)).map((c) => ({ weekId, shiftId: c.shiftId, personId: c.personId, date: date.get(c.shiftId)!, reason: c.reason, open: c.open, message: c.message }))
}

export type CopyResult = { weeks: WeekRow[]; conflicts: RepeatDto["conflicts"]; counts: Counts }

/**
 * The engine of a repeat, shared with the auto-repeat job: copies `source` into `targets` (Mondays, in order) as DRAFTS under the roster lock the caller holds. All or nothing (one
 * transaction; a failure anywhere rolls every week back). Each target week is its own copy of the source, checked against the whole roster including the copies already made in this call.
 * Target rows (the existing drafts to replace) are locked FOR UPDATE in id order first. History and audit per week; no notification, no event.
 */
export async function copyWeek(tx: TenantTx, ctx: RosterCtx, source: { week: WeekRow; zone: string }, targets: { weekStart: string; existing: WeekRow | null }[], reason: "repeat" | "auto_repeat"): Promise<CopyResult> {
  const srcShifts = await tx.select().from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.weekId, source.week.id))).orderBy(asc(rosterShifts.date), asc(rosterShifts.startTime), asc(rosterShifts.id))
  const existing = targets.flatMap((t) => (t.existing ? [t.existing] : []))
  if (existing.length) await tx.select({ id: rosterWeeks.id }).from(rosterWeeks).where(and(eq(rosterWeeks.tenantId, ctx.tenantId), inArray(rosterWeeks.id, existing.map((e) => e.id)))).orderBy(asc(rosterWeeks.id)).for("update")
  const first = targets[0].weekStart
  const last = addDays(targets[targets.length - 1].weekStart, 6)
  const rc = await loadRuleContext(tx, ctx, { weekIds: [source.week.id], from: first, to: last })
  rc.zones = { ...rc.zones, [source.week.locationId]: source.zone }
  const holidays = rc.holidays.map((h) => h.date)
  const eligible = eligibilityOf(rc)
  const src = domainWeek(source.week)
  const srcDomain = srcShifts.map(domainShift)
  let known = [...rc.shifts]
  const weeks: WeekRow[] = []
  const conflicts: RepeatDto["conflicts"] = []
  let counts = ZERO
  for (const t of targets) {
    const ids = [t.existing?.id ?? randomUUID(), ...srcShifts.map(() => randomUUID())]
    const res = domainRepeat(src, srcDomain, t.weekStart, t.existing ? domainWeek(t.existing) : null, true, { ...rc, shifts: known }, holidays, ids, eligible)
    const week = await persist(tx, ctx, source.zone, res, t.existing, srcShifts.map((s) => s.id))
    known = [...known.filter((s) => s.weekId !== week.id), ...res.shifts]
    const c = countOf(res.shifts, res.conflicts)
    await writeHistory(tx, ctx, {
      locationId: week.locationId, weekId: week.id, action: reason === "repeat" ? "week_repeated" : "week_auto_repeated",
      after: { sourceWeekId: source.week.id, weekStart: week.weekStart, replaced: t.existing !== null, shifts: c.copied, kept: c.kept, warned: c.warned, opened: c.opened },
    })
    await auditRoster(tx, ctx, { action: reason === "repeat" ? "roster.week_repeated" : "roster.week_auto_repeated", entity: "roster_week", entityId: week.id, before: null, after: { sourceWeekId: source.week.id, locationId: week.locationId, weekStart: week.weekStart, ...c } })
    weeks.push(week)
    conflicts.push(...conflictDtos(week.id, res, rc.opaque))
    counts = addCounts(counts, c)
  }
  return { weeks, conflicts, counts }
}

/** The weeks at these Mondays of a location, locked FOR UPDATE in id order. */
async function lockTargets(tx: TenantTx, ctx: RosterCtx, locationId: string, starts: string[]): Promise<Map<string, WeekRow>> {
  const rows = await tx.select().from(rosterWeeks).where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.locationId, locationId), inArray(rosterWeeks.weekStart, starts))).orderBy(asc(rosterWeeks.id)).for("update")
  return new Map(rows.map((r) => [r.weekStart, r]))
}

/**
 * POST /v1/roster/weeks/{id}/repeat (`{ version, weeks 1..12, replace? }`, FR-RS-26, 27, R8-12). The source is any week of a location the caller may edit drafts at (a supervisor repeats their own
 * published week: the COPIES are drafts, so the publish lock is not touched). A published target is 409 `week_published` for everybody; a draft target needs `replace` (409 `week_exists_draft`),
 * then its shifts are replaced. A stale source `version` is 409 `version_conflict`; an archived site 409 `location_archived`. Nothing is written unless every target is acceptable.
 */
export async function repeatWeek(tx: TenantTx, ctx: RosterCtx, weekId: string, input: { version: number; weeks: number; replace?: boolean }): Promise<RepeatDto> {
  const loaded = await loadWeek(tx, ctx, weekId, true)
  if (!ctx.access.editDraft) throw Forbidden("forbidden")
  const week = loaded.week
  if (week.version !== input.version) throw Conflict("version_conflict")
  if (loaded.archived) throw Conflict("location_archived")
  if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > MAX_REPEAT_WEEKS) throw unprocessable("invalid_weeks")
  const starts = Array.from({ length: input.weeks }, (_, i) => addDays(week.weekStart, 7 * (i + 1)))
  const found = await lockTargets(tx, ctx, week.locationId, starts)
  for (const s of starts) {
    const t = found.get(s)
    if (t?.status === "published") throw Conflict("week_published")
    if (t && !input.replace) throw Conflict("week_exists_draft")
  }
  const out = await copyWeek(tx, ctx, { week, zone: loaded.zone }, starts.map((s) => ({ weekStart: s, existing: found.get(s) ?? null })), "repeat")
  return { created: await weekDtos(tx, ctx, out.weeks), conflicts: out.conflicts, counts: out.counts }
}

/**
 * PUT /v1/roster/weeks/{id}/auto-repeat (`{ days }`, FR-RS-28): how many days before the next week starts the job creates its draft (1..365, null = off). It is a scheduling setting, not a roster edit:
 * a supervisor of the site sets it on a published week too (the copy is a draft), the week's version does not move, and an unchanged value writes nothing.
 */
export async function setAutoRepeat(tx: TenantTx, ctx: RosterCtx, weekId: string, days: number | null): Promise<WeekDto> {
  const loaded = await loadWeek(tx, ctx, weekId, true)
  if (!ctx.access.editDraft) throw Forbidden("forbidden")
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) throw unprocessable("invalid_days")
  const week = loaded.week
  if (days !== null && loaded.archived) throw Conflict("location_archived")
  let row = week
  if (week.autoRepeatDays !== days) {
    ;[row] = await tx.update(rosterWeeks).set({ autoRepeatDays: days, updatedAt: ctx.now }).where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.id, week.id))).returning()
    await writeHistory(tx, ctx, { locationId: week.locationId, weekId: week.id, action: "auto_repeat_changed", before: { autoRepeatDays: week.autoRepeatDays }, after: { autoRepeatDays: days } })
    await auditRoster(tx, ctx, { action: "roster.auto_repeat_changed", entity: "roster_week", entityId: week.id, before: { autoRepeatDays: week.autoRepeatDays }, after: { autoRepeatDays: days } })
  }
  return (await weekDtos(tx, ctx, [row]))[0]
}

// ------------------------------------------------------------------ templates (FR-RS-29)

type StoredShift = WeekTemplateShift & { typeName: string }
type TemplateRow = typeof rosterWeekTemplates.$inferSelect
const templateDto = (r: TemplateRow): TemplateDto => ({ id: r.id, locationId: r.locationId, name: r.name, shifts: r.shifts.length, createdAt: r.createdAt.toISOString(), createdBy: r.createdBy })
const CTRL = /[\u0000-\u001f\u007f]/

/**
 * POST /v1/roster/weeks/{id}/save-template (`{ name }`): a named copy of the week's people and individual times by weekday (a draft or a published week; the week itself is untouched). The shift
 * type's NAME is kept so the template can be applied at another site. 409 `template_name_taken` (case-insensitive, per location), 409 `template_limit`, 422 `invalid_template` (blank, over 80 characters).
 */
export async function saveTemplate(tx: TenantTx, ctx: RosterCtx, weekId: string, name: string): Promise<TemplateDto> {
  const loaded = await loadWeek(tx, ctx, weekId, false)
  if (!ctx.access.editDraft) throw Forbidden("forbidden")
  const clean = name.trim()
  if (clean.length < 1 || clean.length > 80 || CTRL.test(clean)) throw unprocessable("invalid_template")
  const week = loaded.week
  const taken = await tx.select({ name: rosterWeekTemplates.name }).from(rosterWeekTemplates).where(and(eq(rosterWeekTemplates.tenantId, ctx.tenantId), eq(rosterWeekTemplates.locationId, week.locationId))).for("update")
  if (taken.some((t) => t.name.toLowerCase() === clean.toLowerCase())) throw Conflict("template_name_taken")
  if (taken.length >= MAX_TEMPLATES) throw Conflict("template_limit")
  const rows = await tx
    .select({ s: rosterShifts, typeName: shiftTypes.name })
    .from(rosterShifts)
    .innerJoin(shiftTypes, and(eq(shiftTypes.tenantId, rosterShifts.tenantId), eq(shiftTypes.id, rosterShifts.shiftTypeId)))
    .where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.weekId, week.id)))
    .orderBy(asc(rosterShifts.date), asc(rosterShifts.startTime), asc(rosterShifts.id))
  const shifts: StoredShift[] = rows.map(({ s, typeName }) => ({ day: dayDiff(week.weekStart, s.date), personId: s.userId, templateId: s.shiftTypeId, role: s.role, start: s.startTime, end: s.endTime, unpaidBreakMin: s.unpaidBreakMin, typeName }))
  const [row] = await tx.insert(rosterWeekTemplates).values({ tenantId: ctx.tenantId, locationId: week.locationId, name: clean, shifts, createdBy: ctx.actorId, createdAt: ctx.now, updatedAt: ctx.now }).returning()
  await writeHistory(tx, ctx, { locationId: week.locationId, weekId: week.id, action: "template_saved", after: { templateId: row.id, name: clean, shifts: shifts.length } })
  await auditRoster(tx, ctx, { action: "roster.template_saved", entity: "roster_week_template", entityId: row.id, before: null, after: { locationId: week.locationId, name: clean, shifts: shifts.length } })
  return templateDto(row)
}

/** GET /v1/roster/week-templates?locationId=: the templates of the locations the caller sees (one location: 404 when it is hidden). Counts only: the people stay in the template. */
export async function listTemplates(tx: TenantTx, ctx: RosterCtx, q: { locationId?: string }): Promise<{ items: TemplateDto[] }> {
  if (q.locationId !== undefined) assertLocation(ctx, q.locationId)
  const rows = await tx
    .select()
    .from(rosterWeekTemplates)
    .where(and(eq(rosterWeekTemplates.tenantId, ctx.tenantId), inScopeSql(ctx, rosterWeekTemplates.locationId), q.locationId ? eq(rosterWeekTemplates.locationId, q.locationId) : undefined))
    .orderBy(sql`lower(${rosterWeekTemplates.name})`, asc(rosterWeekTemplates.id))
    .limit(MAX_TEMPLATES * 20)
  return { items: rows.map(templateDto) }
}

/** The template of an id the caller may see: a non-uuid id, a missing one and a hidden location's are one plain 404, before any role check. */
async function loadTemplate(tx: TenantTx, ctx: RosterCtx, id: string, lock: boolean): Promise<TemplateRow> {
  if (!isUuid(id)) throw NotFound()
  const q = tx.select().from(rosterWeekTemplates).where(and(eq(rosterWeekTemplates.tenantId, ctx.tenantId), eq(rosterWeekTemplates.id, id)))
  const [row] = lock ? await q.for("update") : await q
  if (!row) throw NotFound()
  assertLocation(ctx, row.locationId)
  return row
}

/** DELETE /v1/roster/week-templates/{id}: office roles only (a supervisor who can see it: 403). Hidden, missing and non-uuid ids are the same 404. */
export async function deleteTemplate(tx: TenantTx, ctx: RosterCtx, id: string): Promise<void> {
  const row = await loadTemplate(tx, ctx, id, true)
  officeOnly(ctx)
  await tx.delete(rosterWeekTemplates).where(and(eq(rosterWeekTemplates.tenantId, ctx.tenantId), eq(rosterWeekTemplates.id, row.id)))
  await writeHistory(tx, ctx, { locationId: row.locationId, action: "template_deleted", before: { templateId: row.id, name: row.name, shifts: row.shifts.length } })
  await auditRoster(tx, ctx, { action: "roster.template_deleted", entity: "roster_week_template", entityId: row.id, before: { locationId: row.locationId, name: row.name }, after: null })
}

/**
 * POST /v1/roster/week-templates/apply (`{ templateId, locationId, weekStart }`, FR-RS-29): a new DRAFT week from a template. The target must have no roster: an existing week with shifts is 409
 * `week_exists` (with its id), a published one 409 `week_published`; an EMPTY draft is filled. At another site the template's shift types are matched BY NAME (422 `no_matching_type` with the
 * names when one has no namesake) and a person who is not on the target site's team becomes an open shift with a conflict. People who left, lack a qualification or have leave or a clash are
 * opened exactly as in a repeat. 422 `invalid_week_start` for a date that is not a real Monday.
 */
export async function applyTemplate(tx: TenantTx, ctx: RosterCtx, input: { templateId: string; locationId: string; weekStart: string }): Promise<ApplyTemplateDto> {
  if (!ctx.access.editDraft) throw Forbidden("forbidden")
  assertLocation(ctx, input.locationId)
  const tpl = await loadTemplate(tx, ctx, input.templateId, false)
  if (!isMonday(input.weekStart)) throw unprocessable("invalid_week_start")
  const [loc] = await tx.select({ archivedAt: locations.archivedAt, zone: locations.timeZone }).from(locations).where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, input.locationId))).for("share")
  if (!loc) throw NotFound()
  if (loc.archivedAt) throw Conflict("location_archived")
  const existing = (await lockTargets(tx, ctx, input.locationId, [input.weekStart])).get(input.weekStart) ?? null
  if (existing?.status === "published") throw Conflict("week_published")
  if (existing) {
    const [any] = await tx.select({ id: rosterShifts.id }).from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.weekId, existing.id))).limit(1)
    if (any) throw new AppError(409, "week_exists", "Conflict", { weekId: existing.id })
  }
  const zone = loc.zone ?? ctx.tz
  const types = await tx.select().from(shiftTypes).where(and(eq(shiftTypes.tenantId, ctx.tenantId), eq(shiftTypes.locationId, input.locationId), sql`${shiftTypes.archivedAt} is null`)).orderBy(asc(shiftTypes.id))
  const byId = new Map(types.map((t) => [t.id, t]))
  const byName = new Map(types.map((t) => [t.name.toLowerCase(), t]))
  const stored = tpl.shifts as StoredShift[]
  const here = tpl.locationId === input.locationId
  const resolve = (s: StoredShift) => (here ? byId.get(s.templateId) : undefined) ?? byName.get(s.typeName.toLowerCase())
  const missing = [...new Set(stored.filter((s) => !resolve(s)).map((s) => s.typeName))].sort()
  if (missing.length > 0) throw unprocessable("no_matching_type", { typeNames: missing })
  const mapped: WeekTemplate = { id: tpl.id, name: tpl.name, locationId: input.locationId, shifts: stored.map((s) => ({ day: s.day, personId: s.personId, templateId: resolve(s)!.id, role: s.role, start: s.start, end: s.end, unpaidBreakMin: s.unpaidBreakMin })) }
  const people = [...new Set(stored.flatMap((s) => (s.personId ? [s.personId] : [])))].sort()
  const rc = await loadRuleContext(tx, ctx, { personIds: people, from: input.weekStart, to: addDays(input.weekStart, 6) })
  rc.zones = { ...rc.zones, [input.locationId]: zone }
  for (const t of types) if (!rc.templates.some((x) => x.id === t.id)) rc.templates.push({ id: t.id, locationId: t.locationId, name: t.name, start: t.startTime, end: t.endTime, unpaidBreakMin: t.unpaidBreakMin, role: t.role, requires: t.requires } satisfies ShiftTemplate)
  const ids = [existing?.id ?? randomUUID(), ...mapped.shifts.map(() => randomUUID())]
  const res = applyWeekTemplate(mapped, input.locationId, input.weekStart, rc, rc.holidays.map((h) => h.date), ids, eligibilityOf(rc, here ? {} : { homeLocationId: input.locationId }))
  const week = await persist(tx, ctx, zone, res, existing, mapped.shifts.map(() => null))
  const counts = countOf(res.shifts, res.conflicts)
  await writeHistory(tx, ctx, { locationId: week.locationId, weekId: week.id, action: "week_template_applied", after: { templateId: tpl.id, weekStart: week.weekStart, ...counts } })
  await auditRoster(tx, ctx, { action: "roster.template_applied", entity: "roster_week", entityId: week.id, before: null, after: { templateId: tpl.id, locationId: week.locationId, weekStart: week.weekStart, ...counts } })
  return { week: (await weekDtos(tx, ctx, [week]))[0], conflicts: conflictDtos(week.id, res, rc.opaque), counts }
}
