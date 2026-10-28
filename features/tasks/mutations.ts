import { formatDate } from "@/lib/dates"
import { describeRepeat } from "./recurrence"
import { STATUS } from "./types"
import type { Evidence, Task, TaskStatus, TimelineEvent } from "./types"

// Pure, immutable task edits (SRS FR-TASK-04: every change appends a timeline entry). No React, no Date.now():
// `now` always comes from the org clock via nowIso(org.today).

/** Org "now" as a wall-clock ISO string with seconds, e.g. 2026-10-20T09:00:00. */
export const nowIso = (today: string) => `${today.slice(0, 10)}T${today.slice(11, 16)}:00`

const log = (t: Task, by: string, now: string, text: string): TimelineEvent[] => [...t.timeline, { at: now, by, text }]

export function changeStatus(t: Task, to: TaskStatus, by: string, now: string): Task {
  const rest: Task = { ...t, status: to, timeline: log(t, by, now, `Status changed ${STATUS[t.status].label} → ${STATUS[to].label}`) }
  delete rest.submittedAt
  delete rest.completedAt
  if (to === "submitted") return { ...rest, submittedAt: now }
  if (to === "completed") return { ...rest, ...(t.submittedAt ? { submittedAt: t.submittedAt } : {}), completedAt: now }
  // Back to work: lateness is measured from now again, not from an old submission.
  return rest
}

const nextEvidenceId = (t: Task) => {
  const n = t.evidence.reduce((m, e) => Math.max(m, parseInt(e.id.split("-E").pop() ?? "0", 10) || 0), 0)
  return `${t.ref}-E${n + 1}`
}

export function addEvidence(t: Task, item: { kind: Evidence["kind"]; name: string }, by: string, now: string): Task {
  const ev: Evidence = { id: nextEvidenceId(t), kind: item.kind, name: item.name, by, at: now, review: "pending" }
  const label = item.kind === "note" ? "Evidence note added" : item.kind === "link" ? "Evidence link added" : `Evidence added: ${item.name}`
  return { ...t, evidence: [...t.evidence, ev], timeline: log(t, by, now, label) }
}

export function reviewEvidence(t: Task, id: string, review: Exclude<Evidence["review"], "pending">, reason: string | undefined, by: string, now: string): Task {
  const item = t.evidence.find((e) => e.id === id)
  if (!item) return t
  const verb = review === "accepted" ? "accepted" : review === "rejected" ? "rejected" : "asked for more information on"
  const why = reason ? `: ${reason}` : ""
  return {
    ...t,
    evidence: t.evidence.map((e) => (e.id === id ? { ...e, review, ...(reason ? { reason } : { reason: undefined }) } : e)),
    timeline: log(t, by, now, `Evidence ${item.name} ${verb} by ${by}${why}`),
  }
}

export function addNote(t: Task, text: string, by: string, now: string): Task {
  return { ...t, notes: [...t.notes, { at: now, by, text }], timeline: log(t, by, now, "Progress note added") }
}

export function setOverdue(t: Task, o: NonNullable<Task["overdue"]>, by: string, now: string): Task {
  const changed = t.overdue?.revisedDue !== o.revisedDue
  const timeline = log(t, by, now, "Overdue update recorded")
  if (changed) timeline.push({ at: now, by, text: `Revised due date set to ${formatDate(o.revisedDue)}` })
  return { ...t, overdue: o, timeline }
}

export function changeDeadline(t: Task, due: string, by: string, now: string): Task {
  if (due === t.due) return t
  return { ...t, due, timeline: log(t, by, now, `Deadline changed ${formatDate(t.due)} → ${formatDate(due)}`) }
}

/** Sets or clears (rule undefined) the repeat rule of a series task. */
export function setRepeat(t: Task, rule: Task["repeat"], by: string, now: string): Task {
  const { repeat: _old, ...rest } = t
  void _old
  const text = rule ? `Repeat set: ${describeRepeat(rule)}` : "Repeat turned off"
  return { ...rest, ...(rule ? { repeat: rule } : {}), timeline: log(t, by, now, text) }
}
