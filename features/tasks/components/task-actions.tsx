"use client"

import { useState } from "react"
import { toast } from "sonner"

import { ActionButton } from "@/components/action-button"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/dates"
import { missingEvidence } from "@/lib/task-evidence"
import { completeOutcome, isOpen, nextStatuses } from "../lifecycle"
import { STATUS } from "../types"
import type { Task, TaskStatus } from "../types"

const LABEL: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "Start work",
  blocked: "Mark blocked",
  submitted: "Send for verification",
  changes_requested: "Reject",
  completed: "Complete",
  cancelled: "Cancel task",
}

// "Awaiting verification" and "Completed" are worded differently so nobody reads a pending review as done (FR-M1-44).
function stateLine(t: Task, reviewer: string): { tone: "info" | "ok" | "warn" | "mute"; title: string; text: string } | null {
  switch (t.status) {
    case "submitted":
      return { tone: "info", title: "Awaiting verification", text: `${reviewer}. This task is not completed yet.` }
    case "completed":
      return { tone: "ok", title: "Completed", text: t.evidence.some((e) => e.review === "accepted") ? "The evidence is verified." : "This task is done." }
    case "changes_requested":
      return { tone: "warn", title: "Reopened", text: "The evidence was rejected. Read the note, add new evidence and complete again." }
    case "cancelled":
      return { tone: "mute", title: "Cancelled", text: "This task was cancelled and is closed." }
    default:
      return null
  }
}

export function TaskActions({
  task,
  actor,
  canEdit,
  canVerify,
  reviewerText,
  onStatus,
  onComplete,
  onNeedEvidence,
  onVerify,
  onReject,
  manage,
  member,
}: {
  task: Task
  actor: "assignee" | "reviewer"
  canEdit: boolean
  /** May verify / reject this task's evidence (FR-M1-45). */
  canVerify: boolean
  reviewerText: string
  onStatus(to: TaskStatus): void
  onComplete(): void
  /** Required evidence is missing: open the upload step (FR-M1-43). */
  onNeedEvidence(): void
  onVerify(): void
  onReject(reason: string): void
  /** Manager tools (FR-M1-11/13): reschedule, reassign, archive. Omitted for members. */
  manage?: { onReschedule(): void; onReassign(): void; onArchive(): void }
  /** Member tools (Q8): propose new dates. */
  member?: { onPropose(): void }
}) {
  const [confirming, setConfirming] = useState<"cancel" | "archive" | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState("")
  const [reasonErr, setReasonErr] = useState("")
  const next = canEdit ? nextStatuses(task, actor).filter((s) => !(actor === "reviewer" && (s === "completed" || s === "changes_requested"))) : []
  const state = stateLine(task, reviewerText)
  const outcome = completeOutcome(task)
  const missing = missingEvidence(task.evidenceRule, task.evidence)
  const hint =
    actor === "assignee" && next.includes("completed") && outcome === "blocked"
      ? `Complete opens the evidence step: ${missing} more item${missing === 1 ? "" : "s"} needed.`
      : actor === "assignee" && next.includes("completed") && outcome === "submitted"
        ? "Complete sends your evidence for verification."
        : null

  function run(to: TaskStatus) {
    if (to === "cancelled") return setConfirming("cancel")
    if (to === "completed") {
      if (outcome === "blocked") return onNeedEvidence()
      onComplete()
      toast.success(outcome === "submitted" ? `${task.ref}: Awaiting verification` : `${task.ref}: Completed`)
      return
    }
    onStatus(to)
    toast.success(`${task.ref}: ${STATUS[to].label}`)
  }

  const open = isOpen(task)
  const label = (s: TaskStatus) => (s === "in_progress" && task.status !== "not_started" ? "Resume work" : LABEL[s])
  const verifying = canEdit && canVerify && task.status === "submitted"
  return (
    <section className="card td-actions" aria-labelledby="td-actions-h">
      <h2 id="td-actions-h" className="td-h">Actions</h2>
      {task.archivedAt && <p className="td-muted">This task is archived. Restore it to work on it again.</p>}
      {state && !task.archivedAt && (
        <div className={`td-state ${state.tone}`} role="status">
          <strong>{state.title}</strong>
          <span>{state.text}</span>
        </div>
      )}
      {!canEdit && <p className="td-muted">You have read-only access to tasks.</p>}
      {canEdit && !task.archivedAt && next.length === 0 && !verifying && <p className="td-muted">{open ? "No actions are available for you right now." : "No further actions on a closed task."}</p>}
      {(next.length > 0 || verifying) && (
        <div className="td-btns">
          {verifying && (
            <>
              <ActionButton className="btn btn-primary" onDone={() => { onVerify(); toast.success(`${task.ref}: verified and completed`) }}>Verify and complete</ActionButton>
              <button type="button" className="btn btn-outline" onClick={() => setRejecting(true)}>Reject…</button>
            </>
          )}
          {next.map((s) =>
            s === "cancelled" ? (
              <button key={s} type="button" className="btn btn-outline" onClick={() => run(s)}>{label(s)}</button>
            ) : s === "completed" && outcome === "blocked" ? (
              // Opens the upload step instead of moving on (FR-M1-43), so no pending → ✓ animation.
              <button key={s} type="button" className="btn btn-primary" aria-describedby="td-hint" onClick={() => run(s)}>{label(s)}</button>
            ) : (
              <ActionButton key={s} className="btn btn-primary" aria-describedby={s === "completed" && hint ? "td-hint" : undefined} onDone={() => run(s)}>
                {label(s)}
              </ActionButton>
            ),
          )}
        </div>
      )}
      {hint && <p id="td-hint" className="td-hint">{hint}</p>}
      {canEdit && member && open && !task.archivedAt && (
        <div className="td-deadline">
          {task.proposal ? (
            <p className="td-muted">You proposed due {formatDate(task.proposal.due)}. Waiting for your manager.</p>
          ) : (
            <button type="button" className="btn btn-outline" onClick={member.onPropose}>Propose new dates</button>
          )}
        </div>
      )}
      {canEdit && manage && !task.archivedAt && (
        <div className="td-deadline">
          <div className="td-btns">
            {open && <button type="button" className="btn btn-outline" onClick={manage.onReschedule}>Reschedule</button>}
            {open && <button type="button" className="btn btn-outline" onClick={manage.onReassign}>Reassign</button>}
            <button type="button" className="btn btn-outline" onClick={() => setConfirming("archive")}>Remove</button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirming === "cancel"}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Cancel this task?"
        text={`${task.ref} will be closed and can no longer be worked on.`}
        confirmLabel="Cancel task"
        destructive
        onConfirm={() => {
          onStatus("cancelled")
          toast.success(`${task.ref}: Cancelled`)
        }}
      />
      <ConfirmDialog
        open={confirming === "archive"}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Remove this task?"
        text={`${task.ref} moves to the archive. You can restore it for 30 days; after that it is deleted.`}
        confirmLabel="Remove task"
        destructive
        onConfirm={() => {
          manage?.onArchive()
          toast.success(`${task.ref} archived. Restore it from Tasks → Archive within 30 days`)
        }}
      />
      <Dialog open={rejecting} onOpenChange={(o) => { setRejecting(o); if (!o) { setReason(""); setReasonErr("") } }}>
        <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Reject and reopen</DialogTitle>
            <DialogDescription>{task.ref} goes back to the assignee with your comment.</DialogDescription>
          </DialogHeader>
          <form
            className="od-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault()
              if (reason.trim().length < 3) return setReasonErr("Give a short reason")
              onReject(reason.trim())
              toast.success(`${task.ref} reopened for the assignee`)
              setRejecting(false)
              setReason("")
            }}
          >
            <Field label="Reason" htmlFor="td-reject" error={reasonErr || undefined} required>
              <Textarea id="td-reject" placeholder="e.g. The photo doesn't show the exit sign" value={reason} onChange={(e) => { setReason(e.target.value); setReasonErr("") }} />
            </Field>
            <div className="od-form-foot">
              <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
              <button type="submit" className="btn btn-primary">Reject</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
