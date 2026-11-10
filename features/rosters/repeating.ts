import { canSeeLocation, type RosterAccess } from "@/lib/roster-access"
import { applyWeekTemplate, repeatWeek, saveWeekTemplate, type RepeatConflict, type RepeatResult, type WeekTemplate } from "@/lib/roster-repeat"
import type { RuleContext } from "@/lib/roster-rules"
import type { HistoryEntry, RosterShift, RosterWeek } from "@/lib/rosters"
import { addDays } from "@/lib/shifts"

// Repeat and templates with the access rules around the pure functions (FR-RS-22/26..29, D4): only roles that edit drafts, only at
// their own locations (a supervisor can repeat into a draft only; published targets are refused by repeatWeek for everyone).

let seq = 0
const uid = () => (++seq).toString(36)

export type RepeatManyResult = { weeks: RosterWeek[]; shifts: RosterShift[]; entries: HistoryEntry[]; conflicts: RepeatConflict[] }

/**
 * Repeat `source` into the next `count` weeks, one call after another so each check sees the earlier copies (FR-RS-26, Review Focus 3).
 * `weeks` and `shifts` are the full current sets; the result holds the full new sets. All or nothing: any refusal (a published week
 * anywhere in the range, a draft without `replace`) throws and nothing is returned. `idsFor` gives [week id, ...shift ids] for a target.
 */
export function repeatManyChecked(a: RosterAccess, source: RosterWeek, shifts: RosterShift[], weeks: RosterWeek[], count: number, replace: boolean, ctx: RuleContext, holidays: string[], idsFor: (target: string, taken: RosterShift[], shiftCount: number) => string[], by: string, at: string): RepeatManyResult {
  const mine = shifts.filter((s) => s.weekId === source.id)
  let all = shifts
  let wk = weeks
  const entries: HistoryEntry[] = []
  const conflicts: RepeatConflict[] = []
  for (let i = 1; i <= count; i++) {
    const target = addDays(source.weekStart, 7 * i)
    const existing = wk.find((w) => w.locationId === source.locationId && w.weekStart === target) ?? null
    if (existing && replace && existing.status === "draft") all = all.filter((s) => s.weekId !== existing.id)
    const r = repeatChecked(a, source, mine, target, existing, replace, { ...ctx, shifts: all }, holidays, idsFor(target, all, mine.length), by, at)
    all = [...all, ...r.shifts]
    wk = existing ? wk.map((w) => (w.id === existing.id ? r.week : w)) : [...wk, r.week]
    entries.push(r.entry)
    conflicts.push(...r.conflicts)
  }
  return { weeks: wk, shifts: all, entries, conflicts }
}

function guard(a: RosterAccess, ...locationIds: string[]) {
  if (!a.editDraft) throw new Error("This role cannot change a roster")
  for (const id of locationIds) if (!canSeeLocation(a, id)) throw new Error("No access to this location")
}

const counts = (r: RepeatResult) => ({ shifts: r.shifts.length, open: r.conflicts.filter((c) => c.open).length })

/** Repeat one week. The history line carries the new week's id. */
export function repeatChecked(a: RosterAccess, source: RosterWeek, shifts: RosterShift[], target: string, existing: RosterWeek | null, replace: boolean, ctx: RuleContext, holidays: string[], ids: string[], by: string, at: string): RepeatResult & { entry: HistoryEntry } {
  guard(a, source.locationId)
  if (existing && existing.locationId !== source.locationId) throw new Error("That week belongs to another location")
  const r = repeatWeek(source, shifts, target, existing, replace, ctx, holidays, ids)
  return { ...r, entry: { id: `h-${at}-${r.week.id}-repeat-${uid()}`, weekId: r.week.id, locationId: r.week.locationId, shiftId: null, at, by, action: "repeat", before: { from: source.weekStart, replaced: !!existing }, after: { weekStart: target, ...counts(r) }, reason: null } }
}

export function applyTemplateChecked(a: RosterAccess, t: WeekTemplate, locationId: string, weekStart: string, weeks: RosterWeek[], ctx: RuleContext, holidays: string[], ids: string[], by: string, at: string): RepeatResult & { entry: HistoryEntry } {
  guard(a, locationId, t.locationId)
  if (weeks.some((w) => w.locationId === locationId && w.weekStart === weekStart)) throw new Error("That week already has a roster: a template starts a new week only")
  const r = applyWeekTemplate(t, locationId, weekStart, ctx, holidays, ids)
  return { ...r, entry: { id: `h-${at}-${r.week.id}-template-${uid()}`, weekId: r.week.id, locationId, shiftId: null, at, by, action: "template-apply", before: { template: t.name }, after: { weekStart, ...counts(r) }, reason: null } }
}

export function saveTemplateChecked(a: RosterAccess, name: string, week: RosterWeek, shifts: RosterShift[], id: string): WeekTemplate {
  guard(a, week.locationId)
  return saveWeekTemplate(name, week, shifts, id)
}
