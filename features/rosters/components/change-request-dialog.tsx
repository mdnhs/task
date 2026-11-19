"use client"

import { ActionButton } from "@/components/action-button"
import { useRef, useState } from "react"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { TimePicker } from "@/components/time-picker"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { requestChangeBody } from "../publishing"
import type { RosterMember } from "../types"
import type { ViewShift } from "../view"
import { CutHint } from "./cut-hint"

// A supervisor's way to change a published roster (FR-RS-36, D7): new times or person, and why. An office role decides. Who can work the shift is the API's call (422 ineligible comes back as a toast).
export function ChangeRequestDialog({ shift, members, membersTruncated, onSend, onClose }: {
  shift: ViewShift
  members: RosterMember[]
  membersTruncated: boolean
  /** Sends the request; resolves when the API has answered. */
  onSend(body: { patch: Record<string, string | null>; reason: string }): Promise<void> | void
  onClose(): void
}) {
  const [start, setStart] = useState(shift.start)
  const [end, setEnd] = useState(shift.end)
  const [person, setPerson] = useState(shift.personId ?? "")
  const [why, setWhy] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const once = useRef(false)
  const pickable = members.filter((m) => m.active)
  const current = shift.personId && !pickable.some((m) => m.id === shift.personId) ? [{ id: shift.personId, name: shift.person }] : []
  const people = [...current, ...pickable]

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (once.current) return
    const body = requestChangeBody({ start: shift.start, end: shift.end, personId: shift.personId }, { start, end, personId: person || null, reason: why })
    if (!body) { setError(!why.trim() ? "Say why the change is needed" : "Change the times or the person"); return }
    once.current = true
    setBusy(true)
    try {
      await onSend(body)
    } finally {
      once.current = false
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Request change</DialogTitle>
          <DialogDescription>This week is published. An office role approves the change.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <div className="od-row2">
            <Field label="Start" htmlFor="cr-start">
              <TimePicker label="Start" value={start} onChange={(v) => { setStart(v); setError("") }} />
            </Field>
            <Field label="End" htmlFor="cr-end">
              <TimePicker label="End" value={end} onChange={(v) => { setEnd(v); setError("") }} />
            </Field>
          </div>
          <Field label="Person" htmlFor="cr-person">
            <FilterSelect label="Person" value={person} options={[{ value: "", label: "Open shift" }, ...people.map((m) => ({ value: m.id, label: m.name }))]} onChange={(v) => { setPerson(v); setError("") }} />
          </Field>
          <CutHint cut={membersTruncated} />
          <Field label="Why" htmlFor="cr-why" error={error || undefined} required>
            <Input id="cr-why" maxLength={500} placeholder="e.g. Event starts later" value={why} onChange={(e) => { setWhy(e.target.value); setError("") }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" disabled={busy} />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary" disabled={busy}>Send request</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
