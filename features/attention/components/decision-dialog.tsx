"use client"

import { useState } from "react"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { FilterSeg } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { OUTCOME } from "../types"
import type { AttentionItem, Outcome } from "../types"

const schema = z.object({
  outcome: z.enum(["approved", "rejected", "deferred"], { message: "Choose an outcome" }),
  note: z.string().trim().min(3, "Add a note of at least 3 characters").max(500, "Keep the note under 500 characters"),
})

const OUTCOMES = (Object.keys(OUTCOME) as Outcome[]).map((o) => ({ value: o, label: OUTCOME[o] }))

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
          <div className="od-field att-seg" data-invalid={errors.outcome ? "" : undefined}>
            <label id="att-outcome-l">
              Outcome<span className="od-req" aria-hidden="true"> *</span>
            </label>
            <FilterSeg<Outcome | "">
              label="Outcome"
              value={outcome}
              options={OUTCOMES}
              onChange={(v) => {
                setOutcome(v)
                setErrors((e) => ({ ...e, outcome: undefined }))
              }}
            />
            {errors.outcome && (
              <div className="od-field-msg is-enter">
                <p id="att-outcome-msg" className="od-field-err" role="alert">{errors.outcome}</p>
              </div>
            )}
          </div>
          <Field label="Note" htmlFor="att-note" error={errors.note} required>
            <Textarea
              id="att-note"
              placeholder="e.g. Approved for this week only"
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
