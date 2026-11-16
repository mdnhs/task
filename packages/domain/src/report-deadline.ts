// Dashboard "Shift report deadline" card (FR-M1-22, FR-M1-28, FR-M1-30). Pure and server-safe.
// Replaces the old fixed daily deadline (org.deadline, 17:30): every shift has its own due time, `dueAfterMinutes` after
// the shift ends (lib/shifts.ts reportDue). A member sees their own next report; a manager sees each team in their scope.
// Rows come from lib/shift-report.ts reportRows(), already cut to the viewer's scope on the server.

import { formatDate, formatDue, formatTime } from "./dates"
import { REPORT_STATE, draftPhase, itemProgress, needsAction, reportState, type ReportState, type ShiftReport } from "./shift-report"
import { addDays, reportDue, reportsFor, shiftKey, shiftsOn, wallToEpoch, type ShiftOccurrence, type ShiftState } from "./shifts"
import type { Status } from "./types"

export type DeadlineRow = { key: string; label: string; detail: string; progress?: number; status: Status; href: string }
export type ReportDeadline = {
  /** Tenant wall clock of the next report due, or null when none is coming up within the look-ahead. */
  dueAt: string | null
  /** "Due today, 4:00 PM", "Due tomorrow, 4:00 PM", "No shift report due". */
  dueLabel: string
  rows: DeadlineRow[]
  /** Reports past their due time and not submitted, in the card's scope. */
  missing: number
}

/** How far ahead the card looks for the next reporting shift when nothing is open now. */
export const DEADLINE_LOOKAHEAD_DAYS = 7

const ep = (wall: string, tz: string) => wallToEpoch(wall, tz)
const IN: ReportState[] = ["submitted", "late", "accepted", "returned"]
const REPORTS = "/daily-reports"

export function dueLabel(due: string | null, now: string): string {
  if (!due) return "No shift report due"
  const d = due.slice(0, 10)
  const today = now.slice(0, 10)
  const when = d === today ? "today" : d === addDays(today, 1) ? "tomorrow" : formatDate(due)
  return `Due ${when}, ${formatTime(due)}`
}

/** The next reporting shift that has not started yet, for the people `who` accepts. */
export function nextReportingShift(state: ShiftState, now: string, tz: string, who: (personId: string) => boolean): ShiftOccurrence | null {
  const t = ep(now, tz)
  const today = now.slice(0, 10)
  for (let i = 0; i <= DEADLINE_LOOKAHEAD_DAYS; i++) {
    const next = shiftsOn(addDays(today, i), state.patterns, state.assignments, tz)
      .filter((o) => who(o.personId) && ep(o.window.start, tz) > t && reportsFor(o.personId, state.members, state.reporting, o.pattern.team).on)
      .sort((a, b) => ep(a.window.start, tz) - ep(b.window.start, tz))[0]
    if (next) return next
  }
  return null
}

const earliestDue = (rows: ShiftReport[], tz: string): string | null => [...rows].sort((a, b) => ep(a.due, tz) - ep(b.due, tz))[0]?.due ?? null

function memberRow(r: ShiftReport, now: string, tz: string): DeadlineRow {
  const s = reportState(r, now, tz)
  const { done, total } = itemProgress(r)
  const tasks = `${total} ${total === 1 ? "task" : "tasks"}`
  const detail =
    s === "draft"
      ? draftPhase(r, now, tz) === "in_shift"
        ? `In shift now · ${tasks} · due ${formatTime(r.due)}`
        : `Shift ended · ${tasks} · due ${formatTime(r.due)}`
      : s === "missing"
        ? `Was due ${formatDue(r.due, now)}`
        : s === "returned"
          ? "Returned · change it and resubmit"
          : `Submitted ${formatDue(r.submittedAt ?? r.updatedAt, now)}`
  return {
    key: r.id,
    label: r.shiftName,
    detail,
    progress: s === "draft" ? (total ? Math.round((done / total) * 100) : 0) : undefined,
    status: REPORT_STATE[s],
    href: `${REPORTS}/${encodeURIComponent(r.id)}`,
  }
}

/**
 * A member's card (FR-M1-22): the report that needs them most (returned, missing, ended), else the open one, else the
 * latest. The due time is their next open report's, else the next reporting shift's.
 */
export function memberDeadline(personId: string, rows: ShiftReport[], state: ShiftState, now: string, tz: string): ReportDeadline {
  const mine = rows.filter((r) => r.personId === personId)
  const open = mine.filter((r) => reportState(r, now, tz) === "draft")
  let dueAt = earliestDue(open, tz)
  const upcoming = dueAt ? null : nextReportingShift(state, now, tz, (p) => p === personId)
  if (upcoming) dueAt = reportDue(upcoming.window, state.reporting.dueAfterMinutes)
  const latest = [...mine].filter((r) => ep(r.start, tz) <= ep(now, tz)).sort((a, b) => b.start.localeCompare(a.start))[0]
  const focus = needsAction(mine, personId, now, tz)[0] ?? open[0] ?? latest
  const rows_: DeadlineRow[] = focus
    ? [memberRow(focus, now, tz)]
    : upcoming
      ? [{ key: shiftKey(personId, upcoming.window), label: upcoming.pattern.name, detail: `Starts ${formatDue(upcoming.window.start, now)}`, status: { tone: "mute", label: "Upcoming" }, href: REPORTS }]
      : []
  return { dueAt, dueLabel: dueLabel(dueAt, now), rows: rows_, missing: mine.filter((r) => reportState(r, now, tz) === "missing").length }
}

/**
 * A manager's card: per team, the reports of the working day (shifts that ended yesterday or later). Teams follow `teams`
 * order (org.departments); a team with no reporting shift in the day is left out. The due time is the earliest open
 * report's, else the next reporting shift's among the people `who` accepts (the manager's scope).
 */
export function teamDeadline(rows: ShiftReport[], teams: string[], state: ShiftState, now: string, tz: string, who: (personId: string) => boolean): ReportDeadline {
  const since = addDays(now.slice(0, 10), -1)
  const day = rows.filter((r) => r.end.slice(0, 10) >= since && ep(r.start, tz) <= ep(now, tz))
  const out: DeadlineRow[] = []
  let missingAll = 0
  for (const team of teams) {
    const rs = day.filter((r) => r.team === team)
    if (!rs.length) continue
    const st = rs.map((r) => reportState(r, now, tz))
    const inN = st.filter((s) => IN.includes(s)).length
    const missing = st.filter((s) => s === "missing").length
    const open = rs.filter((_, i) => st[i] === "draft")
    missingAll += missing
    // Compact: the missing count already shows as the row's badge.
    const parts = [`${inN}/${rs.length} in`]
    if (open.length) parts.push(`${open.length} due`)
    const q = new URLSearchParams({ team })
    if (missing) q.set("status", "missing")
    out.push({
      key: team,
      label: team,
      detail: parts.join(" · "),
      progress: Math.round((inN / rs.length) * 100),
      status: missing ? { tone: "bad", label: `${missing} missing` } : open.length ? { tone: "info", label: `Due ${formatTime(earliestDue(open, tz)!)}` } : { tone: "ok", label: "All in" },
      href: `${REPORTS}?${q.toString()}`,
    })
  }
  let dueAt = earliestDue(day.filter((r) => reportState(r, now, tz) === "draft"), tz)
  if (!dueAt) {
    const next = nextReportingShift(state, now, tz, who)
    dueAt = next ? reportDue(next.window, state.reporting.dueAfterMinutes) : null
  }
  return { dueAt, dueLabel: dueLabel(dueAt, now), rows: out, missing: missingAll }
}

/** Whole seconds from `now` to `due` (tenant wall clock), never below 0. */
export function secondsUntil(due: string | null, now: string, tz: string): number {
  if (!due) return 0
  return Math.max(0, Math.round((ep(due, tz) - ep(now, tz)) / 1000))
}
