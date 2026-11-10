import { addDays, weekdayOf, weekStart, wallToEpoch, type Weekday } from "./shifts"
import { shiftEnd, shiftMinutes, type RosterShift, type ShiftTemplate } from "./rosters"
import type { WorkforceMember } from "./workforce"

// Roster rule checks (FR-RS-44, D9). Pure. All times are real elapsed time via `wallToEpoch`, so a clock change counts correctly.

export type RuleId = "double_booking" | "approved_leave" | "unavailable" | "daily_rest" | "weekly_rest" | "avg_48h" | "expired_licence" | "left"
export type RuleViolation = { rule: RuleId; shiftId: string; personId: string; severity: "block" | "warn"; message: string; otherShiftIds: string[] }
export type LeaveRequest = { id: string; personId: string; from: string; to: string; kind: string; status: "requested" | "approved" | "rejected"; decidedBy: string | null; decidedAt: string | null }
/** The person is NOT available in this window. */
export type Availability = { personId: string; weekday: Weekday; from: string; to: string }
export type RuleContext = {
  shifts: RosterShift[]
  members: WorkforceMember[]
  leave: LeaveRequest[]
  availability: Availability[]
  templates: ShiftTemplate[]
  severity: Record<RuleId, "block" | "warn">
  avgWeekReferenceWeeks: number
  tz: string
  /** Locations the caller may see; null means all. A clash elsewhere is reported without naming the site or time. */
  visibleLocationIds: string[] | null
}

const MIN_MS = 60_000
const HOUR_MS = 3_600_000
const MIN_DAILY_REST_H = 11
const MIN_WEEKLY_REST_H = 24
const MAX_AVG_H = 48
const WEEK_MS = 7 * 24 * HOUR_MS
const HIDDEN = "Already rostered elsewhere"

type Span = { s: RosterShift; start: number; end: number }

export function blocking(v: RuleViolation[]): RuleViolation[] {
  return v.filter((x) => x.severity === "block")
}

function span(s: RosterShift, tz: string): Span {
  return { s, start: wallToEpoch(`${s.date}T${s.start}`, tz), end: wallToEpoch(shiftEnd(s, tz), tz) }
}

const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const label = (s: RosterShift) => `${s.date} ${s.start}-${s.end}`

export function checkShifts(target: RosterShift[], ctx: RuleContext): RuleViolation[] {
  const { tz } = ctx
  const out: RuleViolation[] = []
  const byPerson = new Map<string, Span[]>()
  for (const s of ctx.shifts) {
    if (!s.personId) continue
    const list = byPerson.get(s.personId) ?? []
    list.push(span(s, tz))
    byPerson.set(s.personId, list)
  }
  for (const list of byPerson.values()) list.sort((a, b) => a.start - b.start)
  const members = new Map(ctx.members.map((m) => [m.id, m]))
  const templates = new Map(ctx.templates.map((t) => [t.id, t]))
  const reportedWeekly = new Map<string, [number, number][]>()

  for (const s of target) {
    const pid = s.personId
    if (!pid) continue
    const m = members.get(pid)
    const name = m?.name ?? pid
    const mine = byPerson.get(pid) ?? []
    const me = span(s, tz)
    const add = (rule: RuleId, message: string, others: string[] = []) =>
      out.push({ rule, shiftId: s.id, personId: pid, severity: ctx.severity[rule], message, otherShiftIds: others })
    const others = mine.filter((o) => o.s.id !== s.id)

    // double booking: any overlap with the same person's other shifts
    const clash = others.filter((o) => o.start < me.end && me.start < o.end)
    const seen = (o: Span) => ctx.visibleLocationIds === null || ctx.visibleLocationIds.includes(o.s.locationId)
    for (const o of clash.filter(seen))
      add("double_booking", `${name} is already on ${label(o.s)}, which overlaps ${label(s)}`, [o.s.id])
    if (clash.some((o) => !seen(o))) add("double_booking", HIDDEN)

    // daily rest: gap to the nearest neighbour on each side. A neighbour at a site the caller can't see gets a generic message.
    let hiddenRest = false
    for (const o of others) {
      const gap = o.end <= me.start ? me.start - o.end : me.end <= o.start ? o.start - me.end : -1
      if (gap >= 0 && gap < MIN_DAILY_REST_H * HOUR_MS) {
        if (!seen(o)) {
          hiddenRest = true
          continue
        }
        const rest = Math.round(gap / MIN_MS)
        add("daily_rest", `${name} has only ${Math.floor(rest / 60)}h${String(rest % 60).padStart(2, "0")} rest between ${label(o.s)} and ${label(s)}`, [o.s.id])
      }
    }
    if (hiddenRest) add("daily_rest", `${name} has less than ${MIN_DAILY_REST_H}h rest between shifts`)

    // weekly rest: two rolling 7-day windows per shift, [start, start+7d] and [end-7d, end]. Gap scan counts the edges, clipped to the
    // window; needs 2+ shifts in the window. A breach overlapping one already reported for this person is not reported again.
    for (const [w0, w1] of [[me.start, me.start + WEEK_MS], [me.end - WEEK_MS, me.end]]) {
      const inWin = mine.filter((o) => o.start < w1 && o.end > w0)
      if (inWin.length < 2) continue
      let cursor = w0
      let best = 0
      for (const o of inWin) {
        best = Math.max(best, o.start - cursor)
        cursor = Math.max(cursor, o.end)
      }
      best = Math.max(best, w1 - cursor)
      if (best >= MIN_WEEKLY_REST_H * HOUR_MS) continue
      const done = reportedWeekly.get(pid) ?? []
      if (done.some(([a, b]) => a < w1 && w0 < b)) continue
      reportedWeekly.set(pid, [...done, [w0, w1]])
      add("weekly_rest", `${name} has no 24h rest in the 7 days around ${label(s)}`, inWin.filter((o) => o.s.id !== s.id && seen(o)).map((o) => o.s.id))
    }

    // 48h average: paid hours in the reference window / number of weeks. The window is the full `avgWeekReferenceWeeks` weeks
    // ending with the shift's week (weeks without data still count). Fails strictly above 48, passes at exactly 48.
    {
      const weeks = Math.max(1, ctx.avgWeekReferenceWeeks)
      const ws = weekStart(s.date)
      const from = addDays(ws, -(weeks - 1) * 7)
      const to = addDays(ws, 7)
      const minutes = mine.filter((o) => o.s.date >= from && o.s.date < to).reduce((n, o) => n + shiftMinutes(o.s, tz), 0)
      const avg = minutes / 60 / weeks
      if (avg > MAX_AVG_H) add("avg_48h", `${name} averages ${avg.toFixed(1)}h a week over ${weeks} weeks (limit ${MAX_AVG_H}h)`)
    }

    // approved leave covers the shift date
    const leave = ctx.leave.find((l) => l.personId === pid && l.status === "approved" && l.from <= s.date && s.date <= l.to)
    if (leave) add("approved_leave", `${name} is on approved leave (${leave.from} to ${leave.to}) on ${s.date}`)

    // unavailable: windows on the start weekday against the shift's part of that day, and for a shift crossing midnight the next
    // weekday against [00:00, end]
    {
      const wd = weekdayOf(s.date)
      const a = hm(s.start)
      const crosses = hm(s.end) <= a
      const b = crosses ? 24 * 60 : hm(s.end)
      const next = ((wd + 1) % 7) as Weekday
      const hit = ctx.availability.find(
        (v) => v.personId === pid && ((v.weekday === wd && a < hm(v.to) && hm(v.from) < b) || (crosses && v.weekday === next && hm(v.from) < hm(s.end))),
      )
      if (hit) add("unavailable", `${name} is unavailable ${hit.from}-${hit.to} on a ${hit.weekday === wd ? s.date : "day after " + s.date}, shift ${s.start}-${s.end}`)
    }

    // licence: any required type expired before the shift date (expiring that day still passes)
    const t = templates.get(s.templateId)
    if (m && t) {
      for (const need of t.requires) {
        const held = m.qualifications.filter((x) => x.type === need)
        if (held.length > 0 && !held.some((q) => q.expires === null || q.expires >= s.date)) {
          const latest = held.map((q) => q.expires ?? "").sort().pop()
          add("expired_licence", `${name}'s ${need} expired on ${latest}, before ${s.date}`)
        }
      }
    }

    if (m?.leftOn && s.date >= m.leftOn) add("left", `${name} left on ${m.leftOn}; shift on ${s.date}`)
  }
  return out
}
