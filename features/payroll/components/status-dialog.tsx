"use client"

import { useState } from "react"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { STATUS, STATUS_ORDER } from "../types"
import type { IssueStatus, PayrollIssue } from "../types"

const noteSchema = z.string().trim().max(500, "Keep the note under 500 characters")
// Resolving needs a resolution note.
const resolveSchema = z.string().trim().min(3, "Add a resolution note of at least 3 characters").max(500, "Keep the note under 500 characters")

// Change an issue's status. Mount with a fresh `key` per open so the form starts from `initial`.
export function StatusDialog({
  issue,
  initial,
  open,
  onOpenChange,
  onChange,
}: {
  issue: PayrollIssue | undefined
  initial: IssueStatus
  open: boolean
  onOpenChange(o: boolean): void
  onChange(ref: string, status: IssueStatus, note: string): void
}) {
  const [status, setStatus] = useState<IssueStatus>(initial)
  const [note, setNote] = useState("")
  const [errors, setErrors] = useState<{ status?: string; note?: string }>({})
  const resolving = status === "resolved"

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!issue) return
    if (status === issue.status) return setErrors({ status: "Choose a different status" })
    const parsed = (resolving ? resolveSchema : noteSchema).safeParse(note)
    if (!parsed.success) return setErrors({ note: parsed.error.issues[0]?.message })
    onChange(issue.ref, status, parsed.data)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{resolving ? "Resolve issue" : "Update status"}</DialogTitle>
          <DialogDescription>{issue ? `${issue.ref} · ${issue.staff}` : "Change the status of this issue."}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <div className="od-field" data-invalid={errors.status ? "" : undefined}>
            <label id="pay-status-l">
              Status<span className="od-req" aria-hidden="true"> *</span>
            </label>
            <div className="er-types" role="group" aria-labelledby="pay-status-l" aria-describedby={errors.status ? "pay-status-msg" : undefined}>
              {STATUS_ORDER.map((s) => (
                <button key={s} type="button" className="rp-day" aria-pressed={status === s} onClick={() => { setStatus(s); setErrors({}) }}>
                  {STATUS[s].label}
                </button>
              ))}
            </div>
            {errors.status && (
              <div className="od-field-msg is-enter">
                <p id="pay-status-msg" className="od-field-err" role="alert">{errors.status}</p>
              </div>
            )}
          </div>
          <Field label={resolving ? "Resolution note" : "Note"} htmlFor="pay-note" error={errors.note} required={resolving}>
            <Textarea
              id="pay-note"
              placeholder={resolving ? "e.g. Paid in the next run" : undefined}
              value={note}
              onChange={(e) => { setNote(e.target.value); setErrors((x) => ({ ...x, note: undefined })) }}
            />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary">{resolving ? "Resolve issue" : "Save status"}</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
