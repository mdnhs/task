import { formatDate } from "@/lib/dates"
import { EVIDENCE_TYPE_LABEL, completeTarget, describeRule, isValidItem, needsReview, type EvidenceType } from "@/lib/task-evidence"
import { describeRepeat } from "./recurrence"
import { STATUS } from "./types"
import type { ChecklistItem, DateProposal, Evidence, EvidenceRule, FieldChange, Task, TaskStatus, TimelineEvent } from "./types"

// Pure, immutable task edits. Every change appends a history entry (FR-M1-12: old and new value). No React, no Date.now():
// `now` always comes from the org clock via nowIso(org.today).

/** Org "now" as a wall-clock ISO string with seconds, e.g. 2026-10-20T09:00:00. */
export const nowIso = (today: string) => `${today.slice(0, 10)}T${today.slice(11, 16)}:00`

const log = (t: Task, by: string, now: string, text: string, changes?: FieldChange[]): TimelineEvent[] => [
  ...t.timeline,
  { at: now, by, text, ...(changes?.length ? { changes } : {}) },
]
const fmtWhen = (iso: string) => `${formatDate(iso)}${iso.length > 10 ? ` ${iso.slice(11, 16)}` : ""}`

export function changeStatus(t: Task, to: TaskStatus, by: string, now: string): Task {
  const rest: Task = {
    ...t,
    status: to,
    timeline: log(t, by, now, `Status changed ${STATUS[t.status].label} → ${STATUS[to].label}`, [{ field: "Status", from: STATUS[t.status].label, to: STATUS[to].label }]),
  }
  delete rest.submittedAt
  delete rest.completedAt
  if (to === "submitted") return { ...rest, submittedAt: now }
  if (to === "completed") return { ...rest, ...(t.submittedAt ? { submittedAt: t.submittedAt } : {}), completedAt: now }
  // Back to work: lateness is measured from now again, not from an old submission.
  return rest
}

// ---------- evidence (CR-05) ----------

const nextEvidenceId = (t: Task) => {
  const n = t.evidence.reduce((m, e) => Math.max(m, parseInt(e.id.split("-E").pop() ?? "0", 10) || 0), 0)
  return `${t.ref}-E${n + 1}`
}
export type NewEvidence = { kind: EvidenceType; name: string; source?: Evidence["source"]; url?: string; size?: number }

/** Attaches an item to the current round. Auto-accept rules accept it on upload (FR-M1-44). */
export function addEvidence(t: Task, item: NewEvidence, by: string, now: string): Task {
  const auto = t.evidenceRule.review === "auto"
  const ev: Evidence = {
    id: nextEvidenceId(t),
    kind: item.kind,
    name: item.name,
    by,
    at: now,
    review: auto ? "accepted" : "pending",
    round: t.round ?? 1,
    ...(item.source ? { source: item.source } : {}),
    ...(item.url ? { url: item.url } : {}),
    ...(item.size ? { size: item.size } : {}),
  }
  const what = item.kind === "note" ? "Evidence note added" : item.kind === "drive" ? "Drive link added" : `${EVIDENCE_TYPE_LABEL[item.kind]} added: ${item.name}`
  return { ...t, evidence: [...t.evidence, ev], timeline: log(t, by, now, auto ? `${what} (accepted automatically)` : what) }
}

/** Removes a draft item. Submitted (locked) evidence is read-only (FR-M1-47) and is never removed. */
export function removeEvidence(t: Task, id: string, by: string, now: string): Task {
  const item = t.evidence.find((e) => e.id === id)
  if (!item || item.locked) return t
  return { ...t, evidence: t.evidence.filter((e) => e.id !== id), timeline: log(t, by, now, `Evidence removed before submitting: ${item.name}`) }
}

const lockAll = (list: Evidence[]) => list.map((e) => (e.locked ? e : { ...e, locked: true }))

/**
 * The assignee presses Complete (FR-M1-43/44). Returns the task unchanged when the minimum isn't met (the UI opens the
 * upload step instead). Otherwise evidence is locked and the task is Completed, or Awaiting verification when a reviewer must check it.
 */
export function completeTask(t: Task, by: string, now: string): Task {
  const to = completeTarget(t.evidenceRule, t.evidence)
  if (to === "blocked") return t
  return { ...changeStatus(t, to, by, now), evidence: lockAll(t.evidence) }
}

/** Reviewer verifies the whole submission: every waiting item is accepted and the task completes (FR-M1-45). */
export function verifyTask(t: Task, by: string, now: string): Task {
  const evidence = t.evidence.map((e) => (isValidItem(e) && e.review !== "accepted" ? { ...e, review: "accepted" as const, reason: undefined } : e))
  const done = changeStatus({ ...t, evidence }, "completed", by, now)
  return { ...done, timeline: [...done.timeline.slice(0, -1), { ...done.timeline.at(-1)!, text: `Evidence verified by ${by}; task completed` }] }
}

/**
 * Reviewer rejects with a reason (FR-M1-45): the waiting items (or the given ones) are rejected and kept as earlier
 * versions (FR-M1-47), the task reopens for the assignee with the comment as a note, and the next submission is a new round.
 */
export function rejectTask(t: Task, reason: string, by: string, now: string, ids?: string[]): Task {
  const hit = (e: Evidence) => (ids ? ids.includes(e.id) : isValidItem(e) && e.review !== "accepted")
  const evidence = t.evidence.map((e) => (hit(e) ? { ...e, review: "rejected" as const, reason, locked: true } : e))
  const reopened = t.status === "changes_requested" ? { ...t } : changeStatus(t, "changes_requested", by, now)
  return {
    ...reopened,
    evidence,
    round: (t.round ?? 1) + 1,
    notes: [...t.notes, { at: now, by, text: `Evidence rejected: ${reason}` }],
    timeline: log(reopened, by, now, `Evidence rejected by ${by}: ${reason}. Task reopened for the assignee`),
  }
}

/**
 * Per-item review. Accepting the last waiting item of a submitted task completes it; rejecting an item of a submitted
 * task reopens it (FR-M1-45). "info_requested" is kept for older data.
 */
export function reviewEvidence(t: Task, id: string, review: Exclude<Evidence["review"], "pending">, reason: string | undefined, by: string, now: string): Task {
  const item = t.evidence.find((e) => e.id === id)
  if (!item) return t
  if (review === "rejected" && t.status === "submitted") return rejectTask(t, reason ?? "", by, now, [id])
  const verb = review === "accepted" ? "verified" : review === "rejected" ? "rejected" : "asked for more information on"
  const why = reason ? `: ${reason}` : ""
  const next: Task = {
    ...t,
    evidence: t.evidence.map((e) => (e.id === id ? { ...e, review, ...(reason ? { reason } : { reason: undefined }) } : e)),
    timeline: log(t, by, now, `Evidence ${item.name} ${verb} by ${by}${why}`),
  }
  const allAccepted = next.evidence.filter(isValidItem).every((e) => e.review === "accepted")
  if (review === "accepted" && t.status === "submitted" && allAccepted && completeTarget(t.evidenceRule, next.evidence) === "completed") {
    return changeStatus(next, "completed", by, now)
  }
  return next
}

/** Creator/manager edits the rule (FR-M1-40). */
export function setEvidenceRule(t: Task, rule: EvidenceRule, by: string, now: string): Task {
  const from = describeRule(t.evidenceRule)
  const to = describeRule(rule)
  if (from === to && t.evidenceRule.instruction === rule.instruction && t.evidenceRule.review === rule.review && t.evidenceRule.reviewer === rule.reviewer) return t
  // Moving to auto-accept settles anything already waiting.
  const evidence = !needsReview(rule) ? t.evidence.map((e) => (isValidItem(e) && e.review === "pending" ? { ...e, review: "accepted" as const } : e)) : t.evidence
  return { ...t, evidenceRule: rule, evidence, timeline: log(t, by, now, "Evidence rule changed", [{ field: "Evidence", from, to }]) }
}

// ---------- notes, overdue, repeat ----------

export function addNote(t: Task, text: string, by: string, now: string): Task {
  return { ...t, notes: [...t.notes, { at: now, by, text }], timeline: log(t, by, now, "Progress note added") }
}

export function setOverdue(t: Task, o: NonNullable<Task["overdue"]>, by: string, now: string): Task {
  const changed = t.overdue?.revisedDue !== o.revisedDue
  const timeline = log(t, by, now, "Overdue update recorded")
  if (changed) timeline.push({ at: now, by, text: `Revised due date set to ${formatDate(o.revisedDue)}` })
  return { ...t, overdue: o, timeline }
}

/** Sets or clears (rule undefined) the repeat rule of a series task. */
export function setRepeat(t: Task, rule: Task["repeat"], by: string, now: string): Task {
  const { repeat: _old, ...rest } = t
  void _old
  const text = rule ? `Repeat set: ${describeRepeat(rule)}` : "Repeat turned off"
  return { ...rest, ...(rule ? { repeat: rule } : {}), timeline: log(t, by, now, text) }
}

// ---------- timeline changes (CR-04) ----------

export function changeDeadline(t: Task, due: string, by: string, now: string): Task {
  if (due === t.due) return t
  return { ...t, due, timeline: log(t, by, now, `Deadline changed ${formatDate(t.due)} → ${formatDate(due)}`, [{ field: "Due", from: fmtWhen(t.due), to: fmtWhen(due) }]) }
}

/** Manager reschedules start and due (FR-M1-11). `why` names a knock-on move ("Moved after TSK-1 moved"). */
export function reschedule(t: Task, to: { start: string; due: string }, by: string, now: string, why?: string): Task {
  const changes: FieldChange[] = []
  if (to.start !== t.start) changes.push({ field: "Start", from: fmtWhen(t.start), to: fmtWhen(to.start) })
  if (to.due !== t.due) changes.push({ field: "Due", from: fmtWhen(t.due), to: fmtWhen(to.due) })
  if (changes.length === 0) return t
  const rest = { ...t, start: to.start, due: to.due }
  delete rest.proposal
  return { ...rest, timeline: log(t, by, now, why ?? "Rescheduled", changes) }
}

/** Reassign: `ids[0]` becomes the primary assignee, the rest co-assignees (FR-M1-01, FR-M1-11). */
export function reassign(t: Task, ids: string[], by: string, now: string, name: (id: string) => string): Task {
  const list = [...new Set(ids.filter(Boolean))]
  if (list.length === 0) return t
  const before = [t.assignee, ...(t.assignees ?? [])]
  if (before.join("|") === list.join("|")) return t
  const [assignee, ...others] = list
  const rest: Task = { ...t, assignee }
  if (others.length) rest.assignees = others
  else delete rest.assignees
  return { ...rest, timeline: log(t, by, now, "Reassigned", [{ field: "Assignees", from: before.map(name).join(", "), to: list.map(name).join(", ") }]) }
}

/** Member proposes new dates (Q8). Replaces an earlier open proposal. */
export function proposeDates(t: Task, p: Omit<DateProposal, "by" | "at">, by: string, now: string): Task {
  return {
    ...t,
    proposal: { ...p, by, at: now },
    timeline: log(t, by, now, `Date change proposed: ${p.reason}`, [{ field: "Due (proposed)", from: fmtWhen(t.due), to: fmtWhen(p.due) }]),
  }
}
export function declineProposal(t: Task, by: string, now: string): Task {
  if (!t.proposal) return t
  const rest = { ...t }
  delete rest.proposal
  return { ...rest, timeline: log(t, by, now, `Date change from ${t.proposal.by} declined`) }
}

// ---------- archive (FR-M1-13) ----------

export function archiveTask(t: Task, by: string, now: string): Task {
  if (t.archivedAt) return t
  return { ...t, archivedAt: now, archivedBy: by, timeline: log(t, by, now, "Task archived (restorable for 30 days)", [{ field: "Archived", from: "No", to: "Yes" }]) }
}
export function restoreTask(t: Task, by: string, now: string): Task {
  if (!t.archivedAt) return t
  const rest = { ...t }
  delete rest.archivedAt
  delete rest.archivedBy
  return { ...rest, timeline: log(t, by, now, "Task restored from the archive", [{ field: "Archived", from: "Yes", to: "No" }]) }
}

// ---------- checklist, dependencies, subtasks (FR-M1-02) ----------

const nextCheckId = (list: ChecklistItem[]) => `c${list.reduce((m, c) => Math.max(m, parseInt(c.id.replace(/\D/g, ""), 10) || 0), 0) + 1}`

export function addChecklistItem(t: Task, text: string, by: string, now: string): Task {
  const list = t.checklist ?? []
  return { ...t, checklist: [...list, { id: nextCheckId(list), text: text.trim(), done: false }], timeline: log(t, by, now, `Checklist item added: ${text.trim()}`) }
}
export function toggleChecklistItem(t: Task, id: string, by: string, now: string): Task {
  const item = t.checklist?.find((c) => c.id === id)
  if (!item) return t
  return {
    ...t,
    checklist: t.checklist!.map((c) => (c.id === id ? { ...c, done: !c.done } : c)),
    timeline: log(t, by, now, `Checklist: ${item.text}`, [{ field: "Checklist", from: item.done ? "Done" : "Open", to: item.done ? "Open" : "Done" }]),
  }
}
export function removeChecklistItem(t: Task, id: string, by: string, now: string): Task {
  const item = t.checklist?.find((c) => c.id === id)
  if (!item) return t
  return { ...t, checklist: t.checklist!.filter((c) => c.id !== id), timeline: log(t, by, now, `Checklist item removed: ${item.text}`) }
}

export function setDependencies(t: Task, refs: string[], by: string, now: string): Task {
  const before = t.dependsOn ?? []
  const after = [...new Set(refs)].filter((r) => r !== t.ref)
  if (before.join("|") === after.join("|")) return t
  const rest = { ...t }
  if (after.length) rest.dependsOn = after
  else delete rest.dependsOn
  return { ...rest, timeline: log(t, by, now, "Dependencies changed", [{ field: "Depends on", from: before.join(", ") || "None", to: after.join(", ") || "None" }]) }
}

/** A subtask: same team, assignee, project and due as the parent; no evidence by default. */
export function makeSubtask(parent: Task, ref: string, title: string, by: string, byId: string, now: string): Task {
  return {
    ref,
    title: title.trim(),
    description: `Subtask of ${parent.ref}: ${parent.title}`,
    dept: parent.dept,
    assignee: parent.assignee,
    creator: byId,
    priority: parent.priority,
    start: now,
    due: parent.due,
    status: "not_started",
    evidenceRule: { mode: "none", types: [], min: 0, instruction: "", review: "manager" },
    tags: [],
    parentRef: parent.ref,
    ...(parent.projectId ? { projectId: parent.projectId } : {}),
    ...(parent.milestoneId ? { milestoneId: parent.milestoneId } : {}),
    notes: [],
    evidence: [],
    timeline: [{ at: now, by, text: `Created by ${by} as a subtask of ${parent.ref}` }],
  }
}
export const noteSubtask = (parent: Task, child: Task, by: string, now: string): Task => ({ ...parent, timeline: log(parent, by, now, `Subtask ${child.ref} added: ${child.title}`) })
