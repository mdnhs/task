"use client"

import { useState } from "react"

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { repeatError } from "../recurrence"
import type { RepeatRule } from "../types"
import { RepeatField, draftToRule, ruleToDraft } from "./repeat-field"

// Edit the repeat rule of an existing series task (FR-TASK-10).
export function RepeatDialog({
  open,
  onOpenChange,
  rule,
  due,
  today,
  onSave,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  rule?: RepeatRule
  due: string
  today: string
  onSave(rule: RepeatRule | undefined): void
}) {
  const [draft, setDraft] = useState(() => ruleToDraft(rule))
  const [error, setError] = useState("")
  function save(e: React.FormEvent) {
    e.preventDefault()
    const next = draftToRule(draft)
    const bad = next ? repeatError(next, due.slice(0, 10)) : ""
    if (bad) return setError(bad)
    onSave(next)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) { setDraft(ruleToDraft(rule)); setError("") } }}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Repeat</DialogTitle>
          <DialogDescription>New copies of this task are made on each date, starting after the current due date.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={save} noValidate>
          <RepeatField id="rd" value={draft} onChange={(v) => { setDraft(v); setError("") }} today={today} min={due.slice(0, 10)} error={error} />
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
