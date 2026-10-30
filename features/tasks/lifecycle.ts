import { isOverdue } from "@/lib/dates"
import { completeTarget, missingEvidence } from "@/lib/task-evidence"
import type { Task, TaskStatus } from "./types"

// Pure task lifecycle rules (SRS §3.3, CR-05). No React, no I/O.

const OPEN: TaskStatus[] = ["not_started", "in_progress", "blocked", "submitted", "changes_requested"]
export const isOpen = (t: Task) => OPEN.includes(t.status)

/**
 * Moves offered to each side. For the assignee "completed" means the Complete button: completeTask() decides whether it
 * lands on Completed or Awaiting verification, and a Required task below its minimum opens the upload step (FR-M1-43).
 * The reviewer verifies (completed) or rejects (changes_requested) a submission, and may cancel any open task.
 */
export function nextStatuses(t: Task, actor: "assignee" | "reviewer"): TaskStatus[] {
  if (t.archivedAt) return []
  if (actor === "reviewer") {
    if (t.status === "submitted") return ["completed", "changes_requested", "cancelled"]
    return isOpen(t) ? ["cancelled"] : []
  }
  switch (t.status) {
    case "not_started":
      return ["in_progress", "blocked", "completed"]
    case "in_progress":
      return ["blocked", "completed"]
    case "blocked":
      return ["in_progress"]
    case "changes_requested":
      return ["in_progress", "completed"]
    default:
      return []
  }
}

/** Enough valid evidence for the rule (FR-M1-43). */
export const canComplete = (t: Task) => missingEvidence(t.evidenceRule, t.evidence) === 0
/** Where Complete would land right now. */
export const completeOutcome = (t: Task) => completeTarget(t.evidenceRule, t.evidence)

/**
 * Kanban drop rules: the same moves as the detail page. Returns the action to run, or why the drop isn't allowed.
 * "complete" runs completeTask(); "verify"/"reject" need the reviewer screen (a reason), so the board sends them there.
 */
export function boardMove(t: Task, to: TaskStatus, actor: "assignee" | "reviewer"): { ok: true; action: "status" | "complete" } | { ok: false; reason: string } {
  if (t.status === to) return { ok: false, reason: "" }
  if (actor === "reviewer" && t.status === "submitted" && (to === "completed" || to === "changes_requested")) {
    return { ok: false, reason: "Open the task to check the evidence before verifying or rejecting it." }
  }
  // On the board a manager moves the team's work the way the assignee would (FR-M1-11).
  if (actor === "reviewer" && to !== "cancelled") return boardMove(t, to, "assignee")
  if (actor === "assignee" && to === "completed" && nextStatuses(t, "assignee").includes("completed")) {
    if (completeOutcome(t) === "blocked") return { ok: false, reason: "Add the required evidence first. Open the task to upload it." }
    return { ok: true, action: "complete" }
  }
  if (actor === "assignee" && to === "submitted" && nextStatuses(t, "assignee").includes("completed")) {
    return completeOutcome(t) === "submitted" ? { ok: true, action: "complete" } : { ok: false, reason: "Use Completed: this task doesn't need verification." }
  }
  if (nextStatuses(t, actor).includes(to)) return { ok: true, action: "status" }
  return { ok: false, reason: `A task can't move from here to that column.` }
}

// FR-TASK-08: late when the submit/complete moment (or now, if still open) is past the due time.
export function isLate(t: Task, nowIso: string): boolean {
  if (t.status === "cancelled") return false
  return isOverdue(t.due, t.submittedAt ?? t.completedAt ?? nowIso)
}
