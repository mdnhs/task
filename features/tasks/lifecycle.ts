import { isOverdue } from "@/lib/dates"
import type { Task, TaskStatus } from "./types"

// Pure task lifecycle rules (SRS §3.3). No React, no I/O.

const OPEN: TaskStatus[] = ["not_started", "in_progress", "blocked", "submitted", "changes_requested"]
export const isOpen = (t: Task) => OPEN.includes(t.status)

// FR-TASK-05: a task needing evidence can only be submitted with at least one item attached.
const canSubmit = (t: Task) => !t.evidenceRequired || t.evidence.length > 0

export function nextStatuses(t: Task, actor: "assignee" | "reviewer"): TaskStatus[] {
  if (actor === "reviewer") {
    if (t.status === "submitted") return ["completed", "changes_requested", "cancelled"]
    return isOpen(t) ? ["cancelled"] : []
  }
  const submit: TaskStatus[] = canSubmit(t) ? ["submitted"] : []
  switch (t.status) {
    case "not_started":
      return ["in_progress", "blocked"]
    case "in_progress":
      return ["blocked", ...submit]
    case "blocked":
      return ["in_progress"]
    case "changes_requested":
      return ["in_progress", ...submit]
    default:
      return []
  }
}

// BR-05: required evidence must exist and every item must be accepted.
export function canComplete(t: Task): boolean {
  if (!t.evidenceRequired) return true
  return t.evidence.length > 0 && t.evidence.every((e) => e.review === "accepted")
}

// FR-TASK-08: late when the submit/complete moment (or now, if still open) is past the due time.
export function isLate(t: Task, nowIso: string): boolean {
  if (t.status === "cancelled") return false
  return isOverdue(t.due, t.submittedAt ?? t.completedAt ?? nowIso)
}
