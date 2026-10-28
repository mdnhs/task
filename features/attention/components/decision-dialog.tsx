"use client"

import { useState } from "react"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { OUTCOME } from "../types"
import type { AttentionItem, Outcome } from "../types"

const schema = z.object({
  outcome: z.enum(["approved", "rejected", "deferred"], { message: "Choose an outcome" }),
  note: z.string().trim().min(3, "Add a note of at least 3 characters").max(500, "Keep the note under 500 characters"),
})

// Record a decision (FR-REV-05): outcome plus a required note. The page stamps the current user and time.
export function DecisionDialog({
  item,
  open,
  onOpenChange,
  onDecide,
}: {
  item: AttentionItem | undefined
  open: boolean
  onOpenChange(o: boolean): void
  onDecide(id: string, outcome: Outcome, note: string): void
}) {
  const [outcome, setOutcome] = useState<Outcome | "">("")
  const [note, setNote] = useState("")
  const [errors, setErrors] = useState<{ outcome?: string; note?: string }>({})

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setOutcome("")
      setNote("")
      setErrors({})
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!item) return
    const parsed = schema.safeParse({ outcome, note })
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof typeof errors
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    onDecide(item.id, parsed.data.outcome, parsed.data.note)
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Record decision</DialogTitle>
          <DialogDescription>{item ? `${item.title}. Requested: ${item.decision}.` : "Choose an outcome and explain it."}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <fieldset className="att-outcomes" aria-describedby={errors.outcome ? "att-outcome-msg" : undefined}>
            <legend>Outcome <span className="od-req" aria-hidden="true">*</span></legend>
            <RadioGroup
              className="od-choices"
              aria-label="Outcome"
              value={outcome}
              onValueChange={(v) => {
                setOutcome(v as Outcome)
                setErrors((e) => ({ ...e, outcome: undefined }))
              }}
            >
              {(Object.keys(OUTCOME) as Outcome[]).map((o) => (
                <label key={o} className="od-choice" data-checked={outcome === o ? "" : undefined}>
                  <RadioGroupItem value={o} aria-label={OUTCOME[o]} />
                  {OUTCOME[o]}
                </label>
              ))}
            </RadioGroup>
            {errors.outcome && <p id="att-outcome-msg" className="od-field-err" role="alert">{errors.outcome}</p>}
          </fieldset>
          <Field label="Note" htmlFor="att-note" error={errors.note} required>
            <Textarea
              id="att-note"
              value={note}
              onChange={(e) => {
                setNote(e.target.value)
                setErrors((x) => (x.note ? { ...x, note: undefined } : x))
              }}
            />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary">Save decision</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
