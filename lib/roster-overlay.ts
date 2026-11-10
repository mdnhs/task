// D3: published roster shifts overlay the shift patterns. Pure. The caller (lib/shifts-data.ts) decides whether to apply it (entitlement M1A).
import type { Location, RosterShift, RosterWeek, ShiftTemplate } from "./rosters"
import { addDays, memberOf, weekdayOf } from "./shifts"
import type { ShiftAssignment, ShiftState } from "./shifts"

/** Removes `[from, until]` (inclusive dates) from an assignment: zero, one or two pieces remain. */
function carve(a: ShiftAssignment, from: string, until: string): ShiftAssignment[] {
  if ((a.until && a.until < from) || a.from > until) return [a]
  const out: ShiftAssignment[] = []
  if (a.from < from) out.push({ ...a, until: addDays(from, -1) })
  const after = addDays(until, 1)
  if (!a.until || a.until > until) out.push({ ...a, from: after > a.from ? after : a.from })
  return out
}

/**
 * Each published, assigned roster shift becomes a one-day pattern (id = roster shift id, so shiftKey stays unique) and a one-day assignment
 * with the shift's own times. A person with a shift in a published week has their pattern assignments carved out for that whole week
 * (Mon-Sun of the roster week) and keeps them the weeks before and after. Drafts and open shifts are ignored.
 */
export function overlayRoster(state: ShiftState, weeks: RosterWeek[], shifts: RosterShift[], templates: ShiftTemplate[], locations: Location[]): ShiftState {
  const published = new Map(weeks.filter((w) => w.status === "published").map((w) => [w.id, w]))
  const tpl = new Map(templates.map((t) => [t.id, t]))
  const loc = new Map(locations.map((l) => [l.id, l]))
  const mine = shifts.filter((s) => s.personId && published.has(s.weekId))
  if (!mine.length) return state

  const carved = new Map<string, Set<string>>() // personId -> week starts
  for (const s of mine) {
    const set = carved.get(s.personId!) ?? new Set<string>()
    set.add(published.get(s.weekId)!.weekStart)
    carved.set(s.personId!, set)
  }
  let assignments = state.assignments
  for (const [personId, starts] of carved) {
    for (const ws of starts) {
      assignments = assignments.flatMap((a) => (a.personId === personId ? carve(a, ws, addDays(ws, 6)) : [a]))
    }
  }

  const patterns = [...state.patterns]
  for (const s of mine) {
    const t = tpl.get(s.templateId)
    const place = loc.get(s.locationId)?.name
    patterns.push({
      id: s.id,
      name: [t?.name ?? s.role, place].filter(Boolean).join(" · "),
      team: memberOf(s.personId!, state.members)?.teams[0] ?? s.role,
      start: s.start,
      end: s.end,
      days: [weekdayOf(s.date)],
    })
    assignments = [...assignments, { personId: s.personId!, patternId: s.id, from: s.date, until: s.date }]
  }
  return { ...state, patterns, assignments }
}
