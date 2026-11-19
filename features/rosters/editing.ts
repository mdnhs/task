import { dayColumns, type StaffingTarget } from "@/lib/rosters"
import type { RuleViolation } from "@/lib/roster-rules"
import { isHm } from "@/lib/shifts"
import type { WorkforceMember } from "@/lib/workforce"
import type { RosterPayload, ShiftTemplate, ShiftType, WeekShift } from "./types"

// Editing shifts on the API (FR-RS-20/21/22; B8 Task 20). Pure: the request bodies, the override pair, and the optimistic copies of the payload. Who may edit is the API's `access`, never worked out here.

// ----------------------------------------------------------------------------------------------------------------- override (AI2 #3)
/** The blocking rules among violations, each once: what `overrideRuleIds` has to name. */
export function blockingRules(violations: RuleViolation[]): string[] {
  return [...new Set(violations.filter((x) => x.severity === "block").map((x) => x.rule))]
}

/**
 * The reason and `overrideRuleIds` of an edit, a publish or a decision, always set TOGETHER. A blank reason is no override (nothing). A reason with blocking violations names them; a reason
 * with nothing blocking (an office edit of a published week) is the reason alone. The API refuses a reason that does not cover a block, and ids without a reason.
 * The reason's key is `reason` on shift edits and publish, `overrideReason` on change-request and exchange decisions (pass it as `key`).
 */
export function overrideFields(reason: string, violations: RuleViolation[]): { reason?: string; overrideRuleIds?: string[] }
export function overrideFields(reason: string, violations: RuleViolation[], key: "overrideReason"): { overrideReason?: string; overrideRuleIds?: string[] }
export function overrideFields(reason: string, violations: RuleViolation[], key: "reason" | "overrideReason" = "reason"): Record<string, string | string[]> {
  const why = reason.trim()
  if (!why) return {}
  const ids = blockingRules(violations)
  return ids.length ? { [key]: why, overrideRuleIds: ids } : { [key]: why }
}

type Gate = { reason?: string; overrideRuleIds?: string[] }

// ----------------------------------------------------------------------------------------------------------------- request bodies
export type ShiftEdit = { date?: string; start?: string; end?: string; unpaidBreakMin?: number; personId?: string | null; templateId?: string; role?: string }

/** PATCH /v1/roster/shifts/{id}: the shift's `version` and only the fields that changed. Null when nothing did (no request). */
export function patchBody(shift: Pick<WeekShift, "version" | "date" | "start" | "end" | "unpaidBreakMin" | "personId" | "templateId" | "role">, edit: ShiftEdit, gate: Gate = {}) {
  const patch: Record<string, string | number | null> = {}
  if (edit.date !== undefined && edit.date !== shift.date) patch.date = edit.date
  if (edit.start !== undefined && edit.start !== shift.start) patch.start = edit.start
  if (edit.end !== undefined && edit.end !== shift.end) patch.end = edit.end
  if (edit.unpaidBreakMin !== undefined && edit.unpaidBreakMin !== shift.unpaidBreakMin) patch.unpaidBreakMin = edit.unpaidBreakMin
  if (edit.personId !== undefined && edit.personId !== shift.personId) patch.userId = edit.personId
  if (edit.templateId !== undefined && edit.templateId !== shift.templateId) patch.shiftTypeId = edit.templateId
  if (edit.role !== undefined && edit.role !== shift.role) patch.role = edit.role
  return Object.keys(patch).length ? { version: shift.version, patch, ...gate } : null
}

export type AddForm = { date: string; people: (string | null)[]; start: string; end: string; unpaidBreakMin: number }
/** POST /v1/roster/weeks/{id}/shifts: one entry, one shift per person (FR-RS-22), none = one open shift. Times go out only when they differ from the shift type's. */
export function addBody(type: Pick<ShiftType, "id" | "start" | "end" | "unpaidBreakMin">, f: AddForm, gate: Gate = {}) {
  const userIds = f.people.length ? [...new Set(f.people)] : [null]
  return {
    shifts: [{
      date: f.date, userIds, shiftTypeId: type.id,
      ...(f.start !== type.start ? { start: f.start } : {}), ...(f.end !== type.end ? { end: f.end } : {}), ...(f.unpaidBreakMin !== type.unpaidBreakMin ? { unpaidBreakMin: f.unpaidBreakMin } : {}),
    }],
    ...gate,
  }
}

// ----------------------------------------------------------------------------------------------------------------- optimistic copies
/** The day columns of the weeks given, counted again from the shifts (the same domain function the API uses). A copy: `p` is never changed. */
function recount(p: RosterPayload, weekIds: Set<string>): RosterPayload {
  const targets: StaffingTarget[] = p.shiftTypes.flatMap((t) => t.targets.map((x) => ({ locationId: t.locationId, templateId: t.id, weekday: x.weekday as StaffingTarget["weekday"], count: x.count })))
  return {
    ...p,
    weeks: p.weeks.map((w) => {
      if (!weekIds.has(w.id)) return w
      const cols = dayColumns(w, p.shifts, targets, p.shiftTypes)
      return { ...w, days: cols.map((c) => ({ date: c.date, shiftIds: c.shifts.map((s) => s.id), count: c.count, target: c.target, short: c.short, over: c.over })) }
    }),
  }
}

/** The shift with these fields changed (a move is `{ date }`); a shift not in the payload leaves it as it was. */
export function setShiftLocal(p: RosterPayload, id: string, edit: ShiftEdit): RosterPayload {
  const s = p.shifts.find((x) => x.id === id)
  if (!s) return p
  const next: WeekShift = {
    ...s, ...(edit.date !== undefined ? { date: edit.date } : {}), ...(edit.start !== undefined ? { start: edit.start } : {}), ...(edit.end !== undefined ? { end: edit.end } : {}),
    ...(edit.unpaidBreakMin !== undefined ? { unpaidBreakMin: edit.unpaidBreakMin } : {}), ...(edit.personId !== undefined ? { personId: edit.personId } : {}),
    ...(edit.templateId !== undefined ? { templateId: edit.templateId } : {}), ...(edit.role !== undefined ? { role: edit.role } : {}),
  }
  return replaceShift(p, next)
}

/** Replace a shift with the API's copy (its new `version`), or add it; the day columns are counted again. */
export function replaceShift(p: RosterPayload, next: WeekShift): RosterPayload {
  const known = p.shifts.some((x) => x.id === next.id)
  return recount({ ...p, shifts: known ? p.shifts.map((x) => (x.id === next.id ? next : x)) : [...p.shifts, next] }, new Set([next.weekId]))
}

export function removeShiftLocal(p: RosterPayload, id: string): RosterPayload {
  const s = p.shifts.find((x) => x.id === id)
  return s ? recount({ ...p, shifts: p.shifts.filter((x) => x.id !== id) }, new Set([s.weekId])) : p
}

let counter = 0
/** A temporary id for a shift the API has not answered for yet (never sent anywhere). */
export const newOpenId = (n: number): string => `local-${n}-${++counter}`

/** The shifts of an add, at once, with temporary ids and version 0; the API's answer replaces them. `key` fixes the ids (the same on every render while the add waits). */
export function shiftsAddedLocal(p: RosterPayload, weekId: string, type: ShiftType, f: AddForm, key?: string): RosterPayload {
  const week = p.weeks.find((w) => w.id === weekId)
  if (!week) return p
  const who = f.people.length ? [...new Set(f.people)] : [null]
  const made: WeekShift[] = who.map((personId, i) => ({
    id: key ? `local-${key}-${i}` : newOpenId(i), weekId, locationId: week.locationId, date: f.date, personId, templateId: type.id, role: type.role, start: f.start, end: f.end, unpaidBreakMin: f.unpaidBreakMin, confirmedAt: null,
    version: 0, startAt: "", endAt: "",
  }))
  return recount({ ...p, shifts: [...p.shifts, ...made] }, new Set([weekId]))
}

/** Drop the temporary shifts of an add the API has answered (or refused). */
export const withoutLocal = (p: RosterPayload): RosterPayload => recount({ ...p, shifts: p.shifts.filter((s) => !s.id.startsWith("local-")) }, new Set(p.weeks.map((w) => w.id)))

// ----------------------------------------------------------------------------------------------------------------- the form
/** FR-RS-04: who may be suggested for a template on `date`: not someone who left on or before it, and each `requires` licence still valid that day. (The roster API checks it again: 422 ineligible.) Kept for the mock-era panels until Task 21. */
export function eligible(members: WorkforceMember[], t: ShiftTemplate, date: string): WorkforceMember[] {
  return members.filter(
    (m) =>
      (m.leftOn === null || date < m.leftOn) &&
      t.requires.every((r) => m.qualifications.some((q) => q.type === r && (q.expires === null || q.expires >= date))),
  )
}

export type ShiftForm = { templateId: string; start: string; end: string; unpaidBreakMin: string }
export type ShiftErrors = Partial<Record<keyof ShiftForm, string>>

export function validateShiftForm(f: ShiftForm): ShiftErrors {
  const e: ShiftErrors = {}
  if (!f.templateId) e.templateId = "Choose a shift"
  if (!isHm(f.start)) e.start = "Pick a start time"
  if (!isHm(f.end)) e.end = "Pick an end time"
  const b = f.unpaidBreakMin.trim() === "" ? NaN : Number(f.unpaidBreakMin)
  if (!(Number.isInteger(b) && b >= 0 && b <= 480)) e.unpaidBreakMin = "Break is 0 to 480 minutes"
  return e
}
