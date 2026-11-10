import { canSeeLocation, type RosterAccess } from "@/lib/roster-access"
import type { HistoryEntry, RosterShift, RosterWeek, ShiftTemplate } from "@/lib/rosters"
import { isHm, weekStart } from "@/lib/shifts"
import type { WorkforceMember } from "@/lib/workforce"

// Editing shifts (FR-RS-20/21/22/04). Pure: who may edit, one shift per person, moving a shift, who to suggest and the audit line.

/** What the form fills in: the shift minus its id and person. */
export type ShiftInput = Pick<RosterShift, "weekId" | "locationId" | "date" | "templateId" | "role" | "start" | "end" | "unpaidBreakMin">

/** Supervisors edit drafts of the locations they manage; office roles edit drafts and published weeks (the reason prompt is Task 7). */
export function canEditShift(a: RosterAccess, week: RosterWeek): boolean {
  if (a.locationIds && !canSeeLocation(a, week.locationId)) return false
  return week.status === "published" ? a.editPublished : a.editDraft
}

/** FR-RS-22: one shift per person, each with its own copy of the times so they can differ afterwards. No people makes one open shift. */
export function addShifts(input: ShiftInput, people: string[], ids: string[]): RosterShift[] {
  const who: (string | null)[] = people.length ? [...new Set(people)] : [null]
  return who.map((personId, i) => ({ ...input, id: ids[i], personId, confirmedAt: null }))
}

/** `addShifts` behind the access guard: the role must be allowed to edit that week, the input must belong to it, and a published week (office only) needs a reason. */
export function addShiftsChecked(a: RosterAccess, week: RosterWeek, input: ShiftInput, people: string[], ids: string[], reason: string | null): RosterShift[] {
  if (!canEditShift(a, week)) throw new Error("This role cannot edit this roster")
  if (input.weekId !== week.id || input.locationId !== week.locationId) throw new Error("Shift is not in this week")
  if (week.status === "published" && !(reason ?? "").trim()) throw new Error("A reason is needed to edit a published roster")
  return addShifts(input, people, ids)
}

/** A shift stays on the date it starts (FR-RS-21); moving it changes the date only. */
export const moveShift = (s: RosterShift, date: string): RosterShift => ({ ...s, date })

/**
 * `moveShift` behind the lock: the role must edit both the shift's week and the target week (a day in the same location), and both must still be
 * drafts. A published week changes only through `editPublished` (reason, history). Returns the shift on the target week.
 */
export function moveShiftChecked(a: RosterAccess, s: RosterShift, from: RosterWeek, to: RosterWeek, date: string): RosterShift {
  if (!canEditShift(a, from) || !canEditShift(a, to)) throw new Error("This role cannot edit this roster")
  if (from.status === "published" || to.status === "published") throw new Error("A published roster changes through an edit with a reason")
  if (s.weekId !== from.id || s.locationId !== from.locationId || to.locationId !== s.locationId) throw new Error("Shift is not in this week")
  if (weekStart(date) !== to.weekStart) throw new Error("That day is not in the target week")
  return { ...moveShift(s, date), weekId: to.id }
}

/**
 * FR-RS-35: remove a shift. A draft week: any role that may edit it. A published week: an office role, with a reason. The audit line keeps the
 * whole shift as `before`. Returns the shifts without it; nothing is mutated.
 */
export function removeShift(a: RosterAccess, week: RosterWeek, shifts: RosterShift[], id: string, by: string, at: string, existing: HistoryEntry[], reason: string | null): { shifts: RosterShift[]; entry: HistoryEntry } {
  const s = shifts.find((x) => x.id === id)
  if (!s || s.weekId !== week.id || s.locationId !== week.locationId) throw new Error("Shift is not in this week")
  if (!canEditShift(a, week)) throw new Error("This role cannot edit this roster")
  const why = (reason ?? "").trim()
  if (week.status === "published" && !why) throw new Error("A reason is needed to edit a published roster")
  return {
    shifts: shifts.filter((x) => x.id !== id),
    entry: { ...shiftHistory("shift.removed", { weekId: week.id, locationId: week.locationId, shiftId: id }, s, null, by, at, existing), reason: why || null },
  }
}

/** FR-RS-04: who may be suggested for a template on `date`. Not someone who left on or before it, and everyone holds each `requires` licence still valid that day. */
export function eligible(members: WorkforceMember[], t: ShiftTemplate, date: string): WorkforceMember[] {
  return members.filter(
    (m) =>
      (m.leftOn === null || date < m.leftOn) &&
      t.requires.every((r) => m.qualifications.some((q) => q.type === r && (q.expires === null || q.expires >= date))),
  )
}

/** After a template or day change: split the picks into those still eligible and those who no longer are. `keep` stays whatever the rules say (the person already on the edited shift while nothing changed). */
export function prunePeople(people: string[], members: WorkforceMember[], t: ShiftTemplate, date: string, keep: string[] = []): { kept: string[]; dropped: string[] } {
  const ok = new Set([...eligible(members, t, date).map((m) => m.id), ...keep])
  return { kept: people.filter((id) => ok.has(id)), dropped: people.filter((id) => !ok.has(id)) }
}

/** Fresh ids for new shifts, unique against the ones in the store. */
export function newShiftIds(count: number, taken: RosterShift[], stamp = Date.now().toString(36)): string[] {
  const used = new Set(taken.map((s) => s.id))
  return Array.from({ length: count }, (_, i) => {
    let n = i
    let id = `s-${stamp}-${n}`
    while (used.has(id)) id = `s-${stamp}-${++n}`
    used.add(id)
    return id
  })
}

/** The audit line for one shift change (week and shift level). */
export function shiftHistory(action: string, where: { weekId: string; locationId: string; shiftId: string }, before: unknown, after: unknown, by: string, at: string, existing: HistoryEntry[]): HistoryEntry {
  return { id: `h-${String(existing.length + 1).padStart(3, "0")}-${Date.now().toString(36)}-${where.shiftId}`, weekId: where.weekId, locationId: where.locationId, shiftId: where.shiftId, at, by, action, before, after, reason: null }
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
