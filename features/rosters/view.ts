import { formatDate } from "@/lib/dates"
import { rosterRange } from "@/lib/rosters"
import type { RuleViolation } from "@/lib/roster-rules"
import { addDays, crossesMidnight, weekStart } from "@/lib/shifts"
import type { RosterPayload, RosterQuery, WeekAccess, WeekRoster, WeekShift } from "./types"

// The /rosters view model (FR-RS-10/11/12), built from the API's week payload (B8 Task 20). The API already cut the payload to the caller's locations and people (I14) and says what the
// caller may do (`access`): this file lays it out and never re-scopes, never re-derives an access rule and never runs a rule check. Counts, targets, short and over are the API's day columns.

export const ROSTER_VIEWS = ["day", "week", "fortnight", "month"] as const
export const ROSTER_GROUPS = ["location", "person", "role"] as const
export type RosterViewKind = (typeof ROSTER_VIEWS)[number]
export type RosterGroup = (typeof ROSTER_GROUPS)[number]

export type ViewShift = {
  id: string; weekId: string; personId: string | null; person: string; open: boolean; role: string; location: string; date: string; start: string; end: string; endsNextDay: boolean
  version: number; templateId: string; unpaidBreakMin: number
  /** Added on screen and not answered by the API yet (a temporary id): it is shown, but cannot be dragged or opened until the API has the real shift. */
  pending: boolean
}
export type ViewDay = {
  date: string; weekId: string | null; hasRoster: boolean; count: number; target: number; short: number; over: number; shifts: ViewShift[]
  /** The week's `access.canEdit`: add, edit and drag are on. */
  canEdit: boolean
  /** The week is published and this level may not edit it: read-only. */
  locked: boolean
  /** Office on a published week: an edit asks for a reason first. */
  reasonRequired: boolean
  /** The week's status (null: no roster this day). */
  weekStatus: "draft" | "published" | null
}
/** A week of the shown range, for the buttons of its location block (publish, repeat, check). */
export type ViewWeek = { id: string; weekStart: string; status: "draft" | "published"; version: number; canEdit: boolean; locked: boolean; autoRepeatDays: number | null }
export type ViewBlock = {
  locationId: string; name: string; status: "draft" | "published" | "none"; days: ViewDay[]; weeks: ViewWeek[]; count: number; target: number
  /** Sum of the days' shortfalls: an over-staffed day never cancels a short one. */
  short: number
  /** The shown range has a published week that this caller may not edit. */
  locked: boolean
  /** The shown week has no roster yet and the caller may start one (top-level `access.canEdit`). */
  canCreate: boolean
  /** The Monday a new week would start on (the shown range's first Monday). */
  createWeekStart: string
}
export type PersonRow = { key: string; name: string; sub: string; open: boolean; cells: ViewShift[][] }
export type RosterViewData = {
  /** "all" or a location id. */
  location: string
  view: RosterViewKind
  group: RosterGroup
  today: string
  from: string
  to: string
  dates: string[]
  locations: { value: string; label: string }[]
  prev: string
  next: string
  /** By location: one board per location. Empty for the other groupings. */
  blocks: ViewBlock[]
  /** By person / by role: grid rows, grouped (one unnamed group for by person). */
  groups: { label: string; rows: PersonRow[] }[]
  /** Shifts assigned in the range and the target they are measured against, for the header numbers. */
  totals: { count: number; target: number; short: number; over: number }
  /** The API's access to a DRAFT week. */
  access: WeekAccess
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const pick = <T extends string>(v: string | undefined, all: readonly T[], fallback: T): T => (all.includes(v as T) ? (v as T) : fallback)

export function weekViewData(payload: RosterPayload, q: RosterQuery, today: string): RosterViewData | { denied: true } {
  const locs = payload.locations
  if (locs.length === 0) return { denied: true }
  const location = q.location ?? locs[0]!.id
  if (location === "all" ? locs.length < 2 : !locs.some((l) => l.id === location)) return { denied: true }

  const view = pick(q.view, ROSTER_VIEWS, "week")
  const group = pick(q.group, ROSTER_GROUPS, "location")
  const anchor = q.week && ISO.test(q.week) ? q.week : today.slice(0, 10)
  const { from, to } = rosterRange(view, anchor)
  const dates: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d)

  const shownLocs = location === "all" ? locs : locs.filter((l) => l.id === location)
  const shownIds = new Set(shownLocs.map((l) => l.id))
  const nameOf = new Map(locs.map((l) => [l.id, l.name]))
  const people = new Map(payload.members.map((m) => [m.id, m.name]))
  const toView = (s: WeekShift): ViewShift => ({
    id: s.id, weekId: s.weekId, personId: s.personId, person: s.personId ? (people.get(s.personId) ?? "Member") : "Open shift", open: s.personId === null, role: s.role,
    location: nameOf.get(s.locationId) ?? "", date: s.date, start: s.start, end: s.end, endsNextDay: crossesMidnight(s), version: s.version, templateId: s.templateId, unpaidBreakMin: s.unpaidBreakMin, pending: s.id.startsWith("local-"),
  })
  const byTime = (a: WeekShift, b: WeekShift) => a.start.localeCompare(b.start) || (people.get(a.personId ?? "") ?? "~").localeCompare(people.get(b.personId ?? "") ?? "~")
  const inRange = payload.shifts.filter((s) => shownIds.has(s.locationId) && s.date >= from && s.date <= to).sort(byTime)

  const blocks: ViewBlock[] = []
  let count = 0
  let target = 0
  let short = 0
  let over = 0
  for (const l of shownLocs) {
    const weeks = payload.weeks.filter((w) => w.locationId === l.id)
    const days: ViewDay[] = dates.map((date) => {
      const week: WeekRoster | undefined = weeks.find((w) => w.weekStart === weekStart(date))
      const col = week?.days.find((d) => d.date === date)
      if (!week || !col) return { date, weekId: null, hasRoster: false, count: 0, target: 0, short: 0, over: 0, shifts: [], canEdit: false, locked: false, reasonRequired: false, weekStatus: null }
      const { canEdit, locked, lockReason } = week.access
      return {
        date, weekId: week.id, hasRoster: true, count: col.count, target: col.target, short: col.short, over: col.over, canEdit, locked, reasonRequired: lockReason === "reason_required", weekStatus: week.status,
        shifts: inRange.filter((s) => s.locationId === l.id && s.date === date).map(toView),
      }
    })
    const inView = weeks.filter((w) => dates.some((d) => weekStart(d) === w.weekStart))
    const status = inView.length === 0 ? "none" : inView.every((w) => w.status === "published") ? "published" : "draft"
    const viewWeeks: ViewWeek[] = [...inView].sort((a, b) => a.weekStart.localeCompare(b.weekStart)).map((w) => ({ id: w.id, weekStart: w.weekStart, status: w.status, version: w.version, canEdit: w.access.canEdit, locked: w.access.locked, autoRepeatDays: w.autoRepeatDays }))
    const sum = (f: (d: ViewDay) => number) => days.reduce((n, d) => n + f(d), 0)
    count += sum((d) => d.count); target += sum((d) => d.target); short += sum((d) => d.short); over += sum((d) => d.over)
    blocks.push({
      locationId: l.id, name: l.name, status, days, weeks: viewWeeks, count: sum((d) => d.count), target: sum((d) => d.target), short: sum((d) => d.short),
      locked: inView.some((w) => w.access.locked), canCreate: inView.length === 0 && payload.access.canEdit, createWeekStart: weekStart(from),
    })
  }

  const cellsOf = (shifts: WeekShift[]): ViewShift[][] => dates.map((d) => shifts.filter((s) => s.date === d).map(toView))
  const rowsOf = (shifts: WeekShift[]): PersonRow[] => {
    const ids = [...new Set(shifts.map((s) => s.personId))]
    return ids
      .map((id) => {
        const mine = shifts.filter((s) => s.personId === id)
        const roles = [...new Set(mine.map((s) => s.role))].join(", ")
        return { key: id ?? "open", name: id ? (people.get(id) ?? "Member") : "Open shifts", sub: roles, open: id === null, cells: cellsOf(mine) }
      })
      .sort((a, b) => Number(a.open) - Number(b.open) || a.name.localeCompare(b.name))
  }
  let groups: RosterViewData["groups"] = []
  if (group === "person") groups = [{ label: "", rows: rowsOf(inRange) }]
  if (group === "role") {
    groups = [...new Set(inRange.map((s) => s.role))].sort().map((role) => ({ label: role, rows: rowsOf(inRange.filter((s) => s.role === role)) }))
  }

  const step = view === "day" ? 1 : view === "week" ? 7 : view === "fortnight" ? 14 : 0
  const prev = step ? addDays(from, -step) : addDays(from, -1)
  const next = step ? addDays(from, step) : addDays(to, 1)
  const options = [...(locs.length > 1 ? [{ value: "all", label: "All locations" }] : []), ...locs.map((l) => ({ value: l.id, label: l.name }))]
  return { location, view, group, today: today.slice(0, 10), from, to, dates, locations: options, prev, next, blocks, groups, totals: { count, target, short, over }, access: payload.access }
}

export type ViolationLine = { key: string; severity: "block" | "warn"; rule: string; person: string; message: string; shifts: { id: string; label: string }[] }

/**
 * The violations the API sent (on a write, a check or a refused publish), each with the person and the shifts named: "Mon 2 Nov 08:00–16:00". Only shifts in the payload are named
 * (the API cut the rest), so a clash at a site the caller cannot see shows no shift and no invented detail. Blocks first.
 */
export function violationLines(violations: RuleViolation[], payload: RosterPayload): ViolationLine[] {
  const byId = new Map(payload.shifts.map((s) => [s.id, s]))
  const people = new Map(payload.members.map((m) => [m.id, m.name]))
  const label = (s: WeekShift) => `${formatDate(s.date)} ${s.start}–${s.end}`
  const lines = violations.map((v, i): ViolationLine => ({
    key: `${v.rule}|${v.shiftId}|${i}`, severity: v.severity, rule: v.rule, person: people.get(v.personId) ?? "Member", message: v.message,
    shifts: [v.shiftId, ...v.otherShiftIds].flatMap((id) => { const s = byId.get(id); return s ? [{ id, label: label(s) }] : [] }),
  }))
  return [...lines.filter((l) => l.severity === "block"), ...lines.filter((l) => l.severity === "warn")]
}

/** The week whose history the panel opens with: the week of the range's first day at the shown location (or the first location), else the first week there is. */
export function historyWeekOf(payload: RosterPayload, locationId?: string): WeekRoster | undefined {
  const loc = locationId ?? payload.locations[0]?.id // the view's own default: the first location
  const here = payload.weeks.filter((w) => !loc || loc === "all" || w.locationId === loc)
  const first = weekStart(payload.range.from)
  return here.find((w) => w.weekStart === first) ?? [...here].sort((a, b) => a.weekStart.localeCompare(b.weekStart))[0]
}
