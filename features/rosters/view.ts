import { canSeeLocation, type RosterAccess } from "@/lib/roster-access"
import { dayColumns, rosterRange, type DayColumn, type RosterShift } from "@/lib/rosters"
import { addDays, crossesMidnight, weekStart } from "@/lib/shifts"
import type { RosterData, RosterEdit, RosterEditExtra, RosterQuery } from "./types"

// The /rosters view model (FR-RS-10/11/12/33), built on the server. It sends only what renders: the permitted locations, the shifts in the
// range and the names of the people on them. Another location's name, shifts and people never reach the client, even if `data` holds them.

export const ROSTER_VIEWS = ["day", "week", "fortnight", "month"] as const
export const ROSTER_GROUPS = ["location", "person", "role"] as const
export type RosterViewKind = (typeof ROSTER_VIEWS)[number]
export type RosterGroup = (typeof ROSTER_GROUPS)[number]

export type ViewShift = { id: string; person: string; open: boolean; role: string; location: string; start: string; end: string; endsNextDay: boolean }
export type ViewDay = { date: string; hasRoster: boolean; count: number; target: number; short: number; over: number; shifts: ViewShift[] }
export type ViewBlock = { locationId: string; name: string; status: "draft" | "published" | "none"; days: ViewDay[]; count: number; target: number; /** Sum of the days' shortfalls: an over-staffed day never cancels a short one. */ short: number }
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
  /** Roles that edit published rosters see the "Manage locations" link. */
  manageLocations: boolean
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const pick = <T extends string>(v: string | undefined, all: readonly T[], fallback: T): T => (all.includes(v as T) ? (v as T) : fallback)

export function rosterViewData(
  data: RosterData,
  access: RosterAccess,
  q: RosterQuery,
  today: string,
): RosterViewData | { denied: true } {
  if (access.scope === "none") return { denied: true }
  const permitted = access.locationIds ?? data.locations.map((l) => l.id)
  const allowed = (id: string) => (access.locationIds ? canSeeLocation(access, id) : permitted.includes(id))
  const allAllowed = access.scope === "all" || access.scope === "own"
  const locs = data.locations.filter((l) => allowed(l.id))
  const location = q.location ?? (access.scope === "own" ? "all" : locs[0]?.id)
  if (!location) return { denied: true }
  if (location === "all" ? !allAllowed : !locs.some((l) => l.id === location)) return { denied: true }

  const view = pick(q.view, ROSTER_VIEWS, "week")
  const group = pick(q.group, ROSTER_GROUPS, "location")
  const anchor = q.week && ISO.test(q.week) ? q.week : today.slice(0, 10)
  const { from, to } = rosterRange(view, anchor)
  const dates: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d)

  const shownLocs = location === "all" ? locs : locs.filter((l) => l.id === location)
  const shownIds = new Set(shownLocs.map((l) => l.id))
  const nameOf = new Map(data.locations.map((l) => [l.id, l.name]))
  const people = new Map(data.members.map((m) => [m.id, m.name]))
  const toView = (s: RosterShift): ViewShift => ({
    id: s.id,
    person: s.personId ? (people.get(s.personId) ?? "Unknown") : "Open shift",
    open: s.personId === null,
    role: s.role,
    location: nameOf.get(s.locationId) ?? "",
    start: s.start,
    end: s.end,
    endsNextDay: crossesMidnight(s),
  })
  const byTime = (a: RosterShift, b: RosterShift) => a.start.localeCompare(b.start) || (people.get(a.personId ?? "") ?? "~").localeCompare(people.get(b.personId ?? "") ?? "~")
  const inRange = data.shifts.filter((s) => shownIds.has(s.locationId) && s.date >= from && s.date <= to).sort(byTime)

  const blocks: ViewBlock[] = []
  let count = 0
  let target = 0
  let short = 0
  let over = 0
  for (const l of shownLocs) {
    const weeks = data.weeks.filter((w) => w.locationId === l.id)
    const cols = new Map<string, DayColumn[]>()
    const days: ViewDay[] = dates.map((date) => {
      const week = weeks.find((w) => w.weekStart === weekStart(date))
      if (!week) return { date, hasRoster: false, count: 0, target: 0, short: 0, over: 0, shifts: [] }
      if (!cols.has(week.id)) cols.set(week.id, dayColumns(week, data.shifts, data.targets, data.templates))
      const c = cols.get(week.id)!.find((x) => x.date === date)!
      return { date, hasRoster: true, count: c.count, target: c.target, short: c.short, over: c.over, shifts: inRange.filter((s) => s.locationId === l.id && s.date === date).map(toView) }
    })
    const inView = weeks.filter((w) => dates.some((d) => weekStart(d) === w.weekStart))
    const status = inView.length === 0 ? "none" : inView.every((w) => w.status === "published") ? "published" : "draft"
    const sum = (f: (d: ViewDay) => number) => days.reduce((n, d) => n + f(d), 0)
    count += sum((d) => d.count); target += sum((d) => d.target); short += sum((d) => d.short); over += sum((d) => d.over)
    blocks.push({ locationId: l.id, name: l.name, status, days, count: sum((d) => d.count), target: sum((d) => d.target), short: sum((d) => d.short) })
  }

  const cellsOf = (shifts: RosterShift[]): ViewShift[][] => dates.map((d) => shifts.filter((s) => s.date === d).map(toView))
  const rowsOf = (shifts: RosterShift[]): PersonRow[] => {
    const ids = [...new Set(shifts.map((s) => s.personId))]
    return ids
      .map((id) => {
        const mine = shifts.filter((s) => s.personId === id)
        const roles = [...new Set(mine.map((s) => s.role))].join(", ")
        return { key: id ?? "open", name: id ? (people.get(id) ?? "Unknown") : "Open shifts", sub: roles, open: id === null, cells: cellsOf(mine) }
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
  const options = [...(allAllowed && locs.length > 1 ? [{ value: "all", label: "All locations" }] : []), ...locs.map((l) => ({ value: l.id, label: l.name }))]
  return {
    location, view, group, today: today.slice(0, 10), from, to, dates, locations: options, prev, next, blocks, groups,
    totals: { count, target, short, over },
    manageLocations: access.editPublished,
  }
}

/** The edit payload for the page, or undefined for roles that can't edit (they get the view data only). */
export function rosterEdit(roster: RosterData, access: RosterAccess, query: RosterQuery, scopeKey: string, me: string, now: string, extra: RosterEditExtra, checkWeek?: RosterEdit["checkWeek"], checkAssign?: RosterEdit["checkAssign"]): RosterEdit | undefined {
  return access.editDraft || access.editPublished ? { roster, access, query, scopeKey, me, now, extra, checkWeek, checkAssign } : undefined
}
