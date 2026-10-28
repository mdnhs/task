"use client"

import { useState } from "react"
import { toast } from "sonner"

import { ActionButton } from "@/components/action-button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { canComplete, isOpen, nextStatuses } from "../lifecycle"
import { STATUS } from "../types"
import type { Task, TaskStatus } from "../types"

const LABEL: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "Start work",
  blocked: "Mark blocked",
  submitted: "Submit for review",
  changes_requested: "Request changes",
  completed: "Mark completed",
  cancelled: "Cancel task",
}

// FR-TASK-12: "submitted" and "completed" are worded differently so nobody reads a pending review as done.
function stateLine(t: Task): { tone: "info" | "ok" | "warn" | "mute"; title: string; text: string } | null {
  switch (t.status) {
    case "submitted":
      return { tone: "info", title: "Submitted for review", text: "Waiting for reviewer approval. This task is not completed yet." }
    case "completed":
      return { tone: "ok", title: "Completed", text: "A reviewer has approved this task." }
    case "changes_requested":
      return { tone: "warn", title: "Changes requested", text: "Update the work and submit it for review again." }
    case "cancelled":
      return { tone: "mute", title: "Cancelled", text: "This task was cancelled and is closed." }
    default:
      return null
  }
}

export function TaskActions({
  task,
  today,
  actor,
  canEdit,
  onStatus,
  onDeadline,
}: {
  task: Task
  today: string
  actor: "assignee" | "reviewer"
  canEdit: boolean
  onStatus(to: TaskStatus): void
  onDeadline(due: string): void
}) {
  const [confirming, setConfirming] = useState(false)
  const [due, setDue] = useState(task.due.slice(0, 16))
  const next = canEdit ? nextStatuses(task, actor) : []
  const state = stateLine(task)
  const completeBlocked = next.includes("completed") && !canComplete(task)
  const needsEvidence =
    canEdit && actor === "assignee" && task.evidenceRequired && task.evidence.length === 0 && (task.status === "in_progress" || task.status === "changes_requested")
  const hint = completeBlocked
    ? "Every evidence item must be accepted before this task can be completed."
    : needsEvidence
      ? "Attach at least one piece of evidence to submit for review."
      : null

  function run(to: TaskStatus) {
    if (to === "cancelled") return setConfirming(true)
    onStatus(to)
    toast.success(`${task.ref}: ${STATUS[to].label}`)
  }

  const open = isOpen(task)
  const label = (s: TaskStatus) => (s === "in_progress" && task.status !== "not_started" ? "Resume work" : LABEL[s])
  return (
    <section className="card td-actions" aria-labelledby="td-actions-h">
      <h2 id="td-actions-h" className="td-h">Actions</h2>
      {state && (
        <div className={`td-state ${state.tone}`} role="status">
          <strong>{state.title}</strong>
          <span>{state.text}</span>
        </div>
      )}
      {!canEdit && <p className="td-muted">You have read-only access to tasks.</p>}
      {canEdit && next.length === 0 && !hint && <p className="td-muted">{open ? "No actions are available for you right now." : "No further actions on a closed task."}</p>}
      {next.length > 0 && (
        <div className="td-btns">
          {next.map((s) => {
            const blocked = s === "completed" && completeBlocked
            // Cancel asks first (ConfirmDialog); the other moves show pending → ✓, then the task moves on.
            return s === "cancelled" ? (
              <button key={s} type="button" className="btn btn-outline" onClick={() => run(s)}>
                {label(s)}
              </button>
            ) : (
              <ActionButton
                key={s}
                className="btn btn-primary"
                disabled={blocked}
                aria-describedby={blocked ? "td-hint" : undefined}
                onDone={() => run(s)}
              >
                {label(s)}
              </ActionButton>
            )
          })}
        </div>
      )}
      {hint && <p id="td-hint" className="td-hint">{hint}</p>}
      {canEdit && actor === "reviewer" && open && (
        <div className="td-deadline">
          <Field label="Change deadline" htmlFor="td-deadline">
            <DatePicker value={due} onChange={setDue} min={today.slice(0, 10)} today={today} withTime label="Deadline" />
          </Field>
          <ActionButton
            className="btn btn-outline"
            disabled={!due || `${due}:00` === task.due}
            onAction={() => {
              onDeadline(`${due}:00`)
              toast.success(`${task.ref}: deadline updated`)
            }}
          >
            Save deadline
          </ActionButton>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Cancel this task?"
        text={`${task.ref} will be closed and can no longer be worked on.`}
        confirmLabel="Cancel task"
        destructive
        onConfirm={() => {
          onStatus("cancelled")
          toast.success(`${task.ref}: Cancelled`)
        }}
      />
    </section>
  )
}
