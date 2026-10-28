"use client"

import { useState } from "react"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"

export type Outcome = "approved" | "rejected" | "deferred"

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: "approved", label: "Approve" },
  { value: "rejected", label: "Reject" },
  { value: "deferred", label: "Defer" },
]

// Quick decision from the dashboard: outcome + required note (FR-REV-05). The full record and history live on /manager-attention.
export function DecideDialog({
  item,
  onClose,
  onDecide,
}: {
  item: { title: string; by: string } | null
  onClose(): void
  onDecide(outcome: Outcome, note: string): void
}) {
  const [outcome, setOutcome] = useState<Outcome>("approved")
  const [note, setNote] = useState("")
  const [noteErr, setNoteErr] = useState<string>()

  function close(o: boolean) {
    if (o) return
    setOutcome("approved")
    setNote("")
    setNoteErr(undefined)
    onClose()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!note.trim()) return setNoteErr("Add a note explaining the decision")
    onDecide(outcome, note.trim())
    close(false)
  }

  return (
    <Dialog open={!!item} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Record decision</DialogTitle>
          <DialogDescription>{item ? `${item.title} · raised by ${item.by}` : ""}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <RadioGroup value={outcome} onValueChange={(v) => setOutcome(v as Outcome)} className="decide-opts" aria-label="Decision">
            {OUTCOMES.map((o) => (
              <label key={o.value} className="decide-opt">
                <RadioGroupItem value={o.value} />
                {o.label}
              </label>
            ))}
          </RadioGroup>
          <Field label="Decision note" htmlFor="decide-note" error={noteErr} required>
            <Textarea id="decide-note" value={note} onChange={(e) => { setNote(e.target.value); setNoteErr(undefined) }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary">Record decision</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
