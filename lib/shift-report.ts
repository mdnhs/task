// End-of-shift report model (SRS FR-M1-22..31, CR-01, CR-03, AC-M1-01..03; Q4 and Q7 built on the SRS assumptions).
// Pure and server-safe (no React, no stores, no I/O). Shift times come from lib/shifts.ts; the server loader is
// lib/shift-reports-data.ts and the client store lives in features/reports/store.ts.
//
// Rules (read before changing)
// - One report per person per shift occurrence; its id is shiftKey(personId, window) ("p-marcus:pat-sec-night:2026-10-19").
// - Only shifts whose effective reporting is on get a report (reportsFor with the SHIFT's team, AC-M1-01).
// - Tasks in a shift (FR-M1-23, AC-M1-02): see taskInShift(). Assigned to the person (any assignee), not archived or cancelled, started before the shift
//   ends, and not finished before the shift starts. So a task due in the window is in, a task still open during the window
//   (including one that is overdue) is in, and a task finished on an earlier shift is out.
// - Statuses (FR-M1-28): stored lifecycle draft → submitted → accepted | returned (→ submitted again). Shown status adds
//   "late" (first submission after the due time) and "missing" (no submission and the due time has passed, FR-M1-30).
// - The due time is `dueAfterMinutes` after the shift end (Q7, tenant setting `reportDueAfterMinutes`).
// - Submitting locks the report (FR-M1-27); only a manager's return opens it again. Submitting produces task updates
//   (FR-M1-26) that the tasks store applies through lib/task-inbox.ts.
// - All times are tenant wall clock ("YYYY-MM-DDTHH:MM[:SS]"); comparisons use real instants (wallToEpoch), like lib/shifts.ts.

import type { Status } from "./types"
import { addDays, durationLabel, managerOf, reportDue, reportsFor, shiftKey, shiftsOn, wallToEpoch, type ShiftOccurrence, type ShiftState, type ShiftWindow, type TeamMember } from "./shifts"
import type { TaskUpdate } from "./task-inbox"
import { isAssignee } from "./task-scope"

// ---------- types ----------

export type ItemStatus = "done" | "in_progress" | "blocked" | "not_started"
export const ITEM_STATUS_ORDER: ItemStatus[] = ["done", "in_progress", "blocked", "not_started"]
export const ITEM_STATUS: Record<ItemStatus, Status> = {
  done: { tone: "ok", label: "Done" },
  in_progress: { tone: "warn", label: "In progress" },
  blocked: { tone: "bad", label: "Blocked" },
  not_started: { tone: "mute", label: "Not started" },
}

/** One task row of the report (FR-M1-23). `title` and `due` are a snapshot of the task when the report was built. */
export type ReportItem = { taskRef: string; title: string; due: string; status: ItemStatus; minutes: number; note: string }
/** Free row for work that was not a task (FR-M1-24). */
export type UnplannedRow = { id: string; text: string; minutes: number }
/** Mock attachment: name and size only, nothing is uploaded. */
export type ReportAttachment = { id: string; name: string; kind: "image" | "file"; size: string }
export type ReportComment = { at: string; by: string; text: string }
export type ReportVersion = { v: number; at: string; by: string; note: string }

export type StoredStatus = "draft" | "submitted" | "accepted" | "returned"
export type ReportState = "draft" | "submitted" | "late" | "missing" | "accepted" | "returned"

export const REPORT_STATE_ORDER: ReportState[] = ["draft", "submitted", "late", "missing", "accepted", "returned"]
export const REPORT_STATE: Record<ReportState, Status> = {
  draft: { tone: "mute", label: "Draft" },
  submitted: { tone: "info", label: "Submitted" },
  late: { tone: "warn", label: "Late" },
  missing: { tone: "bad", label: "Missing" },
  accepted: { tone: "ok", label: "Accepted" },
  returned: { tone: "warn", label: "Returned" },
}

export type ShiftReport = {
  /** shiftKey(personId, window). */
  id: string
  personId: string
  patternId: string
  shiftName: string
  team: string
  /** Shift start date (the shift belongs to it). */
  date: string
  /** Tenant wall clock. */
  start: string
  end: string
  due: string
  status: StoredStatus
  items: ReportItem[]
  summary: string
  blockers: string
  unplanned: UnplannedRow[]
  attachments: ReportAttachment[]
  /** Answers to template sections other than the built-in ones, keyed "sectionId.fieldId". */
  extra: Record<string, string>
  createdAt: string
  updatedAt: string
  /** First submission. Never changed by later resubmissions; decides "late" (versions keep each later time). */
  submittedAt?: string
  reviewedAt?: string
  reviewedBy?: string
  comments: ReportComment[]
  versions: ReportVersion[]
}

/** What the seed stores. Items may be partial: they are overlaid on the tasks found in the shift (see mergeStored). */
export type StoredReport = Omit<ShiftReport, "items" | "shiftName" | "team" | "start" | "end" | "due" | "extra" | "unplanned" | "attachments" | "blockers"> & {
  items?: (Partial<ReportItem> & { taskRef: string })[]
  extra?: Record<string, string>
  unplanned?: UnplannedRow[]
  attachments?: ReportAttachment[]
  blockers?: string
}

/** The fields of a task the report needs (tasks/tasks.json shape). Kept local so lib never imports a feature. */
export type ShiftTask = {
  ref: string
  title: string
  assignee: string
  /** Further assignees (lib/task-scope.ts); the task is in each assignee's report. */
  assignees?: string[]
  status: string
  start: string
  due: string
  /** Archived tasks are left out of reports (FR-M1-13). */
  archivedAt?: string
  evidenceRequired?: boolean
  submittedAt?: string
  completedAt?: string
}

// ---------- template (FR-M1-25) ----------

/** The tenant report template per team (settings/template.json, edited on Settings → Report template). */
export type TemplateField = { id: string; label: string; required: boolean }
export type TemplateSection = { id: string; title: string; enabled: boolean; fields: TemplateField[] }
export type TemplateData = { departments: { dept: string; sections: TemplateSection[] }[] }

/** Section ids the report knows; any other enabled section is an extra free-text section (answers in `extra`). */
export const BUILT_IN_SECTIONS = ["tasks", "summary", "blockers", "unplanned", "attachments"] as const

/** The sections for a team; a team with no template gets the first one (or none). */
export function templateFor(team: string, data: TemplateData): TemplateSection[] {
  return (data.departments.find((d) => d.dept === team) ?? data.departments[0])?.sections ?? []
}

const field = (t: TemplateSection[], sec: string, f: string) => t.find((s) => s.id === sec && s.enabled)?.fields.find((x) => x.id === f)
/** Section is switched on in the template (missing built-in sections count as on, so a bare template still works). */
export function sectionOn(t: TemplateSection[], id: string): boolean {
  const s = t.find((x) => x.id === id)
  return s ? s.enabled : (BUILT_IN_SECTIONS as readonly string[]).includes(id)
}
export const isRequired = (t: TemplateSection[], sec: string, f: string) => !!field(t, sec, f)?.required
/** Enabled template sections that are not built in (free-text extra fields). */
export const extraSections = (t: TemplateSection[]) => t.filter((s) => s.enabled && !(BUILT_IN_SECTIONS as readonly string[]).includes(s.id))

// ---------- tasks in a shift (FR-M1-23) ----------

const FINISHED = new Set(["submitted", "completed"])

/**
 * Is `task` part of `personId`'s shift `w`? Assigned to them, not cancelled, started before the shift ends, and not finished
 * before the shift starts. Finish time = completedAt, else submittedAt, else (finished without a time) the due time.
 */
export function taskInShift(task: ShiftTask, personId: string, w: Pick<ShiftWindow, "start" | "end" | "timeZone">): boolean {
  if (!isAssignee(task, personId) || task.archivedAt || task.status === "cancelled") return false
  const tz = w.timeZone
  const start = wallToEpoch(w.start, tz)
  const end = wallToEpoch(w.end, tz)
  if (wallToEpoch(task.start, tz) >= end) return false
  if (FINISHED.has(task.status)) {
    const finished = task.completedAt ?? task.submittedAt ?? task.due
    if (wallToEpoch(finished, tz) < start) return false
  }
  return true
}

/** The person's tasks in the shift, earliest due first (ref breaks ties). */
export function tasksForShift(personId: string, w: Pick<ShiftWindow, "start" | "end" | "timeZone">, tasks: ShiftTask[]): ShiftTask[] {
  return tasks.filter((t) => taskInShift(t, personId, w)).sort((a, b) => a.due.localeCompare(b.due) || a.ref.localeCompare(b.ref))
}

/** Starting status of a report row from the task's own status. */
export function itemStatusOf(taskStatus: string): ItemStatus {
  if (FINISHED.has(taskStatus)) return "done"
  if (taskStatus === "in_progress" || taskStatus === "changes_requested") return "in_progress"
  if (taskStatus === "blocked") return "blocked"
  return "not_started"
}

export const itemFromTask = (t: ShiftTask): ReportItem => ({ taskRef: t.ref, title: t.title, due: t.due, status: itemStatusOf(t.status), minutes: 0, note: "" })

// ---------- building reports ----------

/** A fresh draft for one shift occurrence: one row per task in the shift, everything else empty. */
export function buildDraft(occ: ShiftOccurrence, tasks: ShiftTask[], dueAfterMinutes: number, now: string): ShiftReport {
  const w = occ.window
  return {
    id: shiftKey(occ.personId, w),
    personId: occ.personId,
    patternId: w.patternId,
    shiftName: occ.pattern.name,
    team: occ.pattern.team,
    date: w.date,
    start: w.start,
    end: w.end,
    due: reportDue(w, dueAfterMinutes),
    status: "draft",
    items: tasksForShift(occ.personId, w, tasks).map(itemFromTask),
    summary: "",
    blockers: "",
    unplanned: [],
    attachments: [],
    extra: {},
    createdAt: now.slice(0, 16) < w.start ? w.start : now.slice(0, 16),
    updatedAt: now.slice(0, 16) < w.start ? w.start : now.slice(0, 16),
    comments: [],
    versions: [],
  }
}

/**
 * A stored report on top of the draft for its shift: stored fields win; stored items overlay the task rows by ref (a stored
 * row whose task is no longer in the shift is kept, it was reported on). Shift fields always come from the shift.
 */
export function mergeStored(draft: ShiftReport, stored: StoredReport): ShiftReport {
  const byRef = new Map((stored.items ?? []).map((i) => [i.taskRef, i]))
  const items = draft.items.map((i) => ({ ...i, ...byRef.get(i.taskRef) }))
  for (const s of stored.items ?? [])
    if (!draft.items.some((i) => i.taskRef === s.taskRef)) items.push({ title: s.taskRef, due: "", status: "not_started", minutes: 0, note: "", ...s })
  return {
    ...draft,
    ...stored,
    items,
    blockers: stored.blockers ?? "",
    unplanned: stored.unplanned ?? [],
    attachments: stored.attachments ?? [],
    extra: stored.extra ?? {},
    id: draft.id,
    personId: draft.personId,
    patternId: draft.patternId,
    shiftName: draft.shiftName,
    team: draft.team,
    date: draft.date,
    start: draft.start,
    end: draft.end,
    due: draft.due,
  }
}

/** The reporting shifts in [from, to] (start dates) that have started by `now`; reporting must be on for the shift's team. */
export function reportingShifts(state: ShiftState, from: string, to: string, now: string, tz: string): ShiftOccurrence[] {
  const out: ShiftOccurrence[] = []
  const t = wallToEpoch(now, tz)
  for (let d = from; d <= to; d = addDays(d, 1))
    for (const o of shiftsOn(d, state.patterns, state.assignments, tz))
      if (wallToEpoch(o.window.start, tz) <= t && reportsFor(o.personId, state.members, state.reporting, o.pattern.team).on) out.push(o)
  return out
}

/**
 * Every report row for the inbox (FR-M1-28): one per reporting shift in the range (stored, else a fresh draft), plus stored
 * reports in the range whose shift no longer reports (reporting switched off later; the report itself is kept). Newest first.
 */
export function reportRows(
  state: ShiftState,
  tasks: ShiftTask[],
  stored: StoredReport[],
  range: { from: string; to: string },
  now: string,
  tz: string,
): ShiftReport[] {
  const byId = new Map(stored.map((s) => [s.id, s]))
  const rows = reportingShifts(state, range.from, range.to, now, tz).map((o) => {
    const draft = buildDraft(o, tasks, state.reporting.dueAfterMinutes, now)
    const s = byId.get(draft.id)
    return s ? mergeStored(draft, s) : draft
  })
  const have = new Set(rows.map((r) => r.id))
  for (const s of stored) {
    if (have.has(s.id) || s.date < range.from || s.date > range.to) continue
    const occ = occurrenceOf(s.id, state, tz)
    if (occ) rows.push(mergeStored(buildDraft(occ, tasks, state.reporting.dueAfterMinutes, now), s))
  }
  return rows.sort((a, b) => b.start.localeCompare(a.start) || a.personId.localeCompare(b.personId))
}

/** The shift occurrence a report id names, or null when its pattern is gone. */
export function occurrenceOf(id: string, state: ShiftState, tz: string): ShiftOccurrence | null {
  const [personId, patternId, date] = id.split(":")
  const pattern = state.patterns.find((p) => p.id === patternId)
  if (!personId || !pattern || !date) return null
  const o = shiftsOn(date, [pattern], [{ personId, patternId, from: date, until: date }], tz)[0]
  return o ?? null
}

// ---------- status (FR-M1-28, FR-M1-30) ----------

const ep = (wall: string, tz: string) => wallToEpoch(wall, tz)

/** First submission came after the due time. */
export function isLate(r: Pick<ShiftReport, "submittedAt" | "due">, tz: string): boolean {
  return !!r.submittedAt && ep(r.submittedAt, tz) > ep(r.due, tz)
}

/** The status shown in the inbox at tenant time `now`. */
export function reportState(r: Pick<ShiftReport, "status" | "submittedAt" | "due">, now: string, tz: string): ReportState {
  if (r.status === "accepted" || r.status === "returned") return r.status
  if (r.status === "submitted") return isLate(r, tz) ? "late" : "submitted"
  return ep(now, tz) > ep(r.due, tz) ? "missing" : "draft"
}

/** "In shift" / "Due 4:00 PM" style phase for a draft, so the UI can say why it is not missing yet. */
export function draftPhase(r: Pick<ShiftReport, "end">, now: string, tz: string): "in_shift" | "open" {
  return ep(now, tz) < ep(r.end, tz) ? "in_shift" : "open"
}

/** Reports that need the member's action now: returned, missing, or ended and not yet submitted. Most urgent first. */
export function needsAction(rows: ShiftReport[], personId: string, now: string, tz: string): ShiftReport[] {
  const rank: Partial<Record<ReportState, number>> = { returned: 0, missing: 1, draft: 2 }
  return rows
    .filter((r) => r.personId === personId)
    .map((r) => ({ r, s: reportState(r, now, tz) }))
    .filter(({ r, s }) => s === "returned" || s === "missing" || (s === "draft" && draftPhase(r, now, tz) === "open"))
    .sort((a, b) => rank[a.s]! - rank[b.s]! || b.r.start.localeCompare(a.r.start))
    .map(({ r }) => r)
}

/** The member's "current or last" report (FR-M1-22): the running shift's, else the latest one that has ended. */
export function currentReport(rows: ShiftReport[], personId: string, now: string, tz: string): ShiftReport | undefined {
  const mine = rows.filter((r) => r.personId === personId && ep(r.start, tz) <= ep(now, tz)).sort((a, b) => b.start.localeCompare(a.start))
  return mine.find((r) => draftPhase(r, now, tz) === "in_shift") ?? mine[0]
}

// ---------- editing, submitting, reviewing ----------

/** Only the owner edits, only while it is a draft or returned, and only with write access (FR-M1-27). */
export function canEditReport(r: Pick<ShiftReport, "personId" | "status">, meId: string, canWrite: boolean): boolean {
  return canWrite && r.personId === meId && (r.status === "draft" || r.status === "returned")
}

/** A manager may accept or return a submitted report (FR-M1-29). */
export const canReviewReport = (r: Pick<ShiftReport, "status">) => r.status === "submitted"

export type ReportError = { key: string; message: string }

/** Required-field check against the team template. Keys: "item:<ref>:minutes", "item:<ref>:note", "summary", "blockers", "unplanned", "attachments", "extra:<sec>.<field>". */
export function validateReport(r: ShiftReport, t: TemplateSection[]): ReportError[] {
  const errs: ReportError[] = []
  if (sectionOn(t, "tasks")) {
    for (const i of r.items) {
      if (isRequired(t, "tasks", "time") && (i.status === "done" || i.status === "in_progress") && !(i.minutes > 0))
        errs.push({ key: `item:${i.taskRef}:minutes`, message: "Enter the time spent" })
      if (isRequired(t, "tasks", "note") && i.status === "blocked" && !i.note.trim()) errs.push({ key: `item:${i.taskRef}:note`, message: "Say what is blocking it" })
    }
  }
  if (sectionOn(t, "summary") && isRequired(t, "summary", "summary") && !r.summary.trim()) errs.push({ key: "summary", message: "Write a short summary of the shift" })
  if (sectionOn(t, "blockers") && isRequired(t, "blockers", "blockers") && !r.blockers.trim()) errs.push({ key: "blockers", message: "Describe any blockers, or write None" })
  if (sectionOn(t, "unplanned") && isRequired(t, "unplanned", "unplanned") && !r.unplanned.some((u) => u.text.trim()))
    errs.push({ key: "unplanned", message: "Add the unplanned work you did" })
  if (sectionOn(t, "attachments") && isRequired(t, "attachments", "attachments") && r.attachments.length === 0) errs.push({ key: "attachments", message: "Attach at least one file" })
  for (const s of extraSections(t))
    for (const f of s.fields) if (f.required && !(r.extra[`${s.id}.${f.id}`] ?? "").trim()) errs.push({ key: `extra:${s.id}.${f.id}`, message: `Fill in ${f.label.toLowerCase()}` })
  return errs
}

/** Submit (or resubmit after a return): locks the report, keeps the first submission time, adds a version. Blank unplanned rows are dropped. */
export function submitReport(r: ShiftReport, now: string, by: string): ShiftReport {
  const resub = r.status === "returned"
  return {
    ...r,
    status: "submitted",
    unplanned: r.unplanned.filter((u) => u.text.trim()),
    submittedAt: r.submittedAt ?? now,
    updatedAt: now,
    versions: [...r.versions, { v: r.versions.length + 1, at: now, by, note: resub ? "Resubmitted" : "Submitted" }],
  }
}

export function acceptReport(r: ShiftReport, now: string, by: string): ShiftReport {
  return { ...r, status: "accepted", reviewedAt: now, reviewedBy: by, updatedAt: now }
}

/** Return with a comment (FR-M1-29): the member can edit and resubmit. */
export function returnReport(r: ShiftReport, now: string, by: string, text: string): ShiftReport {
  return { ...r, status: "returned", reviewedAt: now, reviewedBy: by, updatedAt: now, comments: [...r.comments, { at: now, by, text }] }
}

// ---------- task updates on submit (FR-M1-26) ----------

/**
 * The task status a report row leads to. Rows never move a task backwards: a task already submitted, completed or cancelled
 * keeps its status (time is still logged). Done needs review when the task requires evidence.
 */
export function taskStatusFor(item: ItemStatus, current: string, evidenceRequired: boolean): string {
  if (current === "submitted" || current === "completed" || current === "cancelled") return current
  if (item === "done") return evidenceRequired ? "submitted" : "completed"
  if (item === "in_progress") return "in_progress"
  if (item === "blocked") return "blocked"
  return current
}

/** One update per row, ids unique per report version so applying twice is a no-op. */
export function taskUpdatesFor(r: ShiftReport, tenantId: string, by: string, at: string): TaskUpdate[] {
  const v = r.versions.length
  const label = `shift report ${r.shiftName}, ${r.date}`
  return r.items.map((i) => ({
    id: `${r.id}:v${v}:${i.taskRef}`,
    tenantId,
    ref: i.taskRef,
    itemStatus: i.status,
    minutes: Math.max(0, Math.round(i.minutes) || 0),
    note: i.note.trim(),
    at,
    by,
    source: label,
  }))
}

// ---------- scope (who sees which reports) ----------

export type ReportScope = { kind: "all" } | { kind: "team"; managerId: string } | { kind: "own"; personId: string }

/** Everyone below `managerId` in the reporting lines (direct and indirect). */
export function teamOf(managerId: string, members: TeamMember[]): Set<string> {
  const out = new Set<string>()
  const queue = [managerId]
  while (queue.length) {
    const m = queue.shift()!
    for (const x of members)
      if (x.managerId === m && !out.has(x.personId)) {
        out.add(x.personId)
        queue.push(x.personId)
      }
  }
  return out
}

export function inScope(personId: string, scope: ReportScope, members: TeamMember[]): boolean {
  if (scope.kind === "all") return true
  if (scope.kind === "own") return personId === scope.personId
  return teamOf(scope.managerId, members).has(personId)
}

export function scopeReports<T extends { personId: string }>(rows: T[], scope: ReportScope, members: TeamMember[]): T[] {
  return rows.filter((r) => inScope(r.personId, scope, members))
}

// ---------- missing alerts (FR-M1-30) ----------

/** Who to alert about a missing report: the member and their primary manager. */
export function missingRecipients(r: Pick<ShiftReport, "personId">, members: TeamMember[]): { member: string; manager: string | null } {
  return { member: r.personId, manager: managerOf(r.personId, members) }
}

// ---------- filters (FR-M1-28) ----------

export type ReportFilters = { from: string; to: string; team: string; person: string; status: string }
export const EMPTY_REPORT_FILTERS: ReportFilters = { from: "", to: "", team: "all", person: "all", status: "all" }

type Raw = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "")

/** Reads ?from=&to=&team=&person=&status=. Unknown values fall back to all / empty. */
export function parseReportFilters(sp: Raw, known: { teams: string[]; people: string[] }): ReportFilters {
  const team = one(sp.team)
  const person = one(sp.person)
  const status = one(sp.status)
  return {
    from: day(one(sp.from)),
    to: day(one(sp.to)),
    team: team && known.teams.includes(team) ? team : "all",
    person: person && known.people.includes(person) ? person : "all",
    status: REPORT_STATE_ORDER.includes(status as ReportState) ? (status as string) : "all",
  }
}

export function matchesReport(r: ShiftReport, state: ReportState, f: ReportFilters): boolean {
  return (
    (!f.from || r.date >= f.from) &&
    (!f.to || r.date <= f.to) &&
    (f.team === "all" || r.team === f.team) &&
    (f.person === "all" || r.personId === f.person) &&
    (f.status === "all" || state === f.status)
  )
}

// ---------- labels ----------

const clock = (wall: string) => wall.slice(11, 16)
/** "07:00–15:00", "22:00–07:00 +1". */
export function windowLabel(r: Pick<ShiftReport, "start" | "end">): string {
  return `${clock(r.start)}–${clock(r.end)}${r.end.slice(0, 10) > r.start.slice(0, 10) ? " +1" : ""}`
}

export const totalMinutes = (r: Pick<ShiftReport, "items" | "unplanned">) =>
  r.items.reduce((n, i) => n + (i.minutes || 0), 0) + r.unplanned.reduce((n, u) => n + (u.minutes || 0), 0)

/** "2h 30m", "0m". */
export const minutesText = (m: number) => (m <= 0 ? "0m" : m < 60 ? `${m}m` : durationLabel(m))

/** Rows the member has answered: a row counts once its status was confirmed with time or a note. */
export function itemProgress(r: Pick<ShiftReport, "items">): { done: number; total: number } {
  return { done: r.items.filter((i) => i.minutes > 0 || i.note.trim()).length, total: r.items.length }
}
