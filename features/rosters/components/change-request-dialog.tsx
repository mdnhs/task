"use client"

import { ActionButton } from "@/components/action-button"
import { useState } from "react"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { TimePicker } from "@/components/time-picker"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { WorkforceMember } from "@/lib/workforce"
import { eligible } from "../editing"
import type { RosterShift, ShiftTemplate } from "../types"

// A supervisor's way to change a published roster (FR-RS-36, D7): new times or person, and why. An office role decides.
export function ChangeRequestDialog({ shift, template, members, onSend, onClose }: {
  shift: RosterShift
  template?: ShiftTemplate
  members: WorkforceMember[]
  onSend(patch: Partial<RosterShift>, why: string): void
  onClose(): void
}) {
  const [start, setStart] = useState(shift.start)
  const [end, setEnd] = useState(shift.end)
  const [person, setPerson] = useState(shift.personId ?? "")
  const [why, setWhy] = useState("")
  const [error, setError] = useState("")
  const pool = template ? eligible(members, template, shift.date) : members
  const current = shift.personId ? members.find((m) => m.id === shift.personId) : undefined
  const people = current && !pool.some((m) => m.id === current.id) ? [current, ...pool] : pool

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const patch: Partial<RosterShift> = {}
    if (start !== shift.start) patch.start = start
    if (end !== shift.end) patch.end = end
    if (person !== (shift.personId ?? "")) patch.personId = person || null
    if (!Object.keys(patch).length) { setError("Change the times or the person"); return }
    if (!why.trim()) { setError("Say why the change is needed"); return }
    onSend(patch, why.trim())
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
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
          <Field label="Why" htmlFor="cr-why" error={error || undefined} required>
            <Input id="cr-why" placeholder="e.g. Event starts later" value={why} onChange={(e) => { setWhy(e.target.value); setError("") }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary">Send request</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
