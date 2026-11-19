"use client"

import { ActionButton } from "@/components/action-button"
import { useRef, useState } from "react"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatDate } from "@/lib/dates"
import type { ViewShift } from "../view"
import { CutHint } from "./cut-hint"

// Hand one of your own shifts to a colleague (FR-RS-42). The colleague is a person the caller may know (the API's list); whether they can work it is the API's call (422 ineligible, 404 for someone
// outside the caller's sites). The approver decides (D6). One field, so the dialog never scrolls.
export function SwapDialog({ shift, place, people, truncated, onSend, onClose }: {
  shift: Pick<ViewShift, "date" | "start" | "end">
  place: string
  people: { id: string; name: string }[]
  /** The API cut the colleague list at its cap. */
  truncated?: boolean
  /** Sends the request; resolves when the API has answered. */
  onSend(personId: string): Promise<void> | void
  onClose(): void
}) {
  const [person, setPerson] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const once = useRef(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (once.current) return
    if (!person) { setError("Pick who takes the shift"); return }
    once.current = true
    setBusy(true)
    try {
      await onSend(person)
    } finally {
      once.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Swap shift</DialogTitle>
          <DialogDescription>{formatDate(shift.date)} · {shift.start}–{shift.end} · {place}. A manager approves the swap.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Give it to" htmlFor="sw-person" error={error || undefined} required>
            {people.length === 0 ? (
              <p className="rl-empty">Nobody else to give it to.</p>
            ) : (
              <FilterSelect label="Give it to" value={person} options={[{ value: "", label: "Choose a person" }, ...people.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => { setPerson(v); setError("") }} />
            )}
          </Field>
          <CutHint cut={!!truncated} />
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" disabled={busy} />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary" disabled={people.length === 0 || busy}>Send request</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
