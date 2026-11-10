"use client"

import { useState } from "react"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDate } from "@/lib/dates"
import type { RosterShift } from "../types"

// Ask to hand one of your shifts to a co-worker (FR-RS-42). The list is only the people who can work it (id and name from the server).
// Whoever approves the swap (D6) runs the full rule check. One field, so the dialog never scrolls.
export function SwapDialog({ shift, place, people, onSend, onClose }: {
  shift: RosterShift
  place: string
  people: { id: string; name: string }[]
  onSend(personId: string): void
  onClose(): void
}) {
  const [person, setPerson] = useState("")
  const [error, setError] = useState("")
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!person) { setError("Pick who takes the shift"); return }
    onSend(person)
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Swap shift</DialogTitle>
          <DialogDescription>{formatDate(shift.date)} · {shift.start}–{shift.end} · {place}. A manager approves the swap.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Give it to" htmlFor="sw-person" error={error || undefined} required>
            {people.length === 0 ? (
              <p className="rl-empty">Nobody else at this location can work this shift.</p>
            ) : (
              <FilterSelect label="Give it to" value={person} options={[{ value: "", label: "Choose a person" }, ...people.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => { setPerson(v); setError("") }} />
            )}
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary" disabled={people.length === 0}>Send request</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
