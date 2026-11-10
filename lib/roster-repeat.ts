import { checkShifts, type RuleContext, type RuleId } from "./roster-rules"
import type { RosterShift, RosterWeek } from "./rosters"
import { addDays, weekStart } from "./shifts"

// Repeat a roster and week templates (FR-RS-22/26..29, AC-RS-06, D10). Pure. A shift that breaks a block-severity rule never drops: it becomes an open
// shift plus a conflict; a warn-severity break or a public holiday is only an info conflict and the person stays. The check of each copy includes the copies
// already made in this repeat and the shifts of every other week in ctx, so two copies can clash with each other.

export type RepeatConflict = { shiftId: string; personId: string; reason: RuleId | "public_holiday" | "not_in_location"; open: boolean; message: string }
export type RepeatResult = { week: RosterWeek; shifts: RosterShift[]; conflicts: RepeatConflict[] }
/** One shift of a template: `day` is days after the week's Monday (0..6). */
export type WeekTemplateShift = { day: number; personId: string | null; templateId: string; role: string; start: string; end: string; unpaidBreakMin: number }
export type WeekTemplate = { id: string; name: string; locationId: string; shifts: WeekTemplateShift[] }

const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
const weekStartOf = weekStart
const isMonday = (d: string) => weekStart(d) === d

type Draft = Omit<RosterShift, "id" | "weekId" | "locationId" | "confirmedAt">

/** Checks each draft shift in turn against ctx + the accepted ones; failing ones open. `foreign` names people who may not work this location. */
function place(week: RosterWeek, drafts: (Draft & { date: string })[], ctx: RuleContext, holidays: string[], ids: string[], base: RosterShift[], foreign: (personId: string) => boolean): RepeatResult {
  const shifts: RosterShift[] = []
  const conflicts: RepeatConflict[] = []
  const made: RosterShift[] = []
  drafts.forEach((d, i) => {
    const s: RosterShift = { ...d, id: ids[i + 1], weekId: week.id, locationId: week.locationId, confirmedAt: null }
    if (s.personId) {
      const pid = s.personId
      if (foreign(pid)) {
        conflicts.push({ shiftId: s.id, personId: pid, reason: "not_in_location", open: true, message: `Not on this location's team on ${s.date}` })
        s.personId = null
      } else {
        const found = checkShifts([s], { ...ctx, shifts: [...base, ...made, s] })
        const hard = found.find((x) => x.severity === "block")
        const soft = found[0]
        if (hard) {
          conflicts.push({ shiftId: s.id, personId: pid, reason: hard.rule, open: true, message: hard.message })
          s.personId = null
        } else if (soft) {
          conflicts.push({ shiftId: s.id, personId: pid, reason: soft.rule, open: false, message: soft.message })
        } else if (holidays.includes(s.date)) {
          conflicts.push({ shiftId: s.id, personId: pid, reason: "public_holiday", open: false, message: `Public holiday on ${s.date}` })
        }
      }
    }
    shifts.push(s)
    made.push(s)
  })
  return { week, shifts, conflicts }
}

/**
 * FR-RS-22/26: copy `source` into the week starting `targetWeekStart` (a Monday). `ids[0]` is the new week's id (unused when `existing`
 * is given), the rest are shift ids. A published `existing` week throws; a draft one throws unless `replace`, then its old shifts are
 * left out of the check and the caller removes them by week id (the returned shifts are the complete new set).
 */
export function repeatWeek(source: RosterWeek, shifts: RosterShift[], targetWeekStart: string, existing: RosterWeek | null, replace: boolean, ctx: RuleContext, holidays: string[], ids: string[]): RepeatResult {
  if (!isMonday(targetWeekStart)) throw new Error("A roster week starts on a Monday")
  if (existing && existing.status === "published") throw new Error("That week is already published")
  if (existing && !replace) throw new Error("That week already has a draft: choose replace")
  const week: RosterWeek = existing
    ? { ...existing }
    : { id: ids[0], locationId: source.locationId, weekStart: targetWeekStart, status: "draft", publishedAt: null, publishedBy: null, autoRepeatDays: source.autoRepeatDays }
  const offset = dayDiff(source.weekStart, targetWeekStart)
  const drafts = shifts
    .filter((s) => s.weekId === source.id)
    .map((s) => ({ date: addDays(s.date, offset), personId: s.personId, templateId: s.templateId, role: s.role, start: s.start, end: s.end, unpaidBreakMin: s.unpaidBreakMin }))
  const base = ctx.shifts.filter((s) => s.weekId !== week.id)
  return place(week, drafts, ctx, holidays, ids, base, () => false)
}

/** Weeks (one per location: the latest) whose next week is within their `autoRepeatDays` of `today` and doesn't exist yet. */
export function autoRepeatDue(weeks: RosterWeek[], today: string): RosterWeek[] {
  const day = today.slice(0, 10)
  const latest = new Map<string, RosterWeek>()
  for (const w of weeks) {
    const cur = latest.get(w.locationId)
    if (!cur || w.weekStart > cur.weekStart) latest.set(w.locationId, w)
  }
  return [...latest.values()].filter((w) => {
    if (w.autoRepeatDays === null || w.autoRepeatDays === undefined) return false
    const next = addDays(w.weekStart, 7)
    return dayDiff(day, next) <= w.autoRepeatDays && dayDiff(day, next) >= 0
  })
}

/** FR-RS-27: a named copy of a week's shifts (people and times, by weekday). */
export function saveWeekTemplate(name: string, week: RosterWeek, shifts: RosterShift[], id: string): WeekTemplate {
  const clean = name.trim()
  if (!clean) throw new Error("Give the template a name")
  return {
    id,
    name: clean,
    locationId: week.locationId,
    shifts: shifts
      .filter((s) => s.weekId === week.id)
      .map((s) => ({ day: dayDiff(week.weekStart, s.date), personId: s.personId, templateId: s.templateId, role: s.role, start: s.start, end: s.end, unpaidBreakMin: s.unpaidBreakMin }))
      .sort((a, b) => a.day - b.day),
  }
}

/**
 * FR-RS-28: a new draft week at `locationId` from a template. At another location than the template's, a person whose home location isn't
 * that location becomes an open shift, and the shift takes that location's own shift type with the same times when there is one.
 */
export function applyWeekTemplate(t: WeekTemplate, locationId: string, weekStart: string, ctx: RuleContext, holidays: string[], ids: string[]): RepeatResult {
  if (!isMonday(weekStart)) throw new Error("A roster week starts on a Monday")
  if (ctx.shifts.some((x) => x.locationId === locationId && weekStartOf(x.date) === weekStart)) throw new Error("That week already has shifts: a template starts a new week only")
  const week: RosterWeek = { id: ids[0], locationId, weekStart, status: "draft", publishedAt: null, publishedBy: null, autoRepeatDays: null }
  const elsewhere = locationId !== t.locationId
  const homes = new Map(ctx.members.map((m) => [m.id, m.homeLocationId]))
  const drafts = t.shifts.map((s) => {
    const own = elsewhere ? ctx.templates.find((x) => x.locationId === locationId && x.start === s.start && x.end === s.end) : undefined
    return { date: addDays(weekStart, s.day), personId: s.personId, templateId: own ? own.id : elsewhere ? "" : s.templateId, role: own?.role ?? s.role, start: s.start, end: s.end, unpaidBreakMin: s.unpaidBreakMin }
  })
  return place(week, drafts, ctx, holidays, ids, ctx.shifts.filter((s) => s.weekId !== week.id), (pid) => elsewhere && homes.get(pid) !== locationId)
}
