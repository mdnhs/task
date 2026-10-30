"use client"

import { useState } from "react"

import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { activeAssignment, patternTimeLabel } from "@/lib/shifts"
import type { ShiftPattern, ShiftState } from "@/lib/shifts"
import type { Person } from "@/lib/types"

// Assign a person to a shift pattern from a start date (FR-M1-20). Patterns of the person's teams are listed first.
export function AssignDialog({
  person,
  open,
  onOpenChange,
  state,
  teamsOf,
  today,
  onAssign,
}: {
  person: Person | undefined
  open: boolean
  onOpenChange(o: boolean): void
  state: ShiftState
  teamsOf(personId: string): string[]
  /** Tenant date "YYYY-MM-DD". */
  today: string
  onAssign(person: Person, pattern: ShiftPattern, from: string): void
}) {
  const [patternId, setPatternId] = useState("")
  const [from, setFrom] = useState(today)
  const [errors, setErrors] = useState<{ pattern?: string; from?: string }>({})
  const [seen, setSeen] = useState({ id: person?.id, open })
  if (seen.id !== person?.id || seen.open !== open) {
    setSeen({ id: person?.id, open })
    if (open) {
      setPatternId("")
      setFrom(today)
      setErrors({})
    }
  }

  const mine = person ? teamsOf(person.id) : []
  const sorted = [...state.patterns].sort((a, b) => Number(!mine.includes(a.team)) - Number(!mine.includes(b.team)) || a.team.localeCompare(b.team) || a.name.localeCompare(b.name))
  const options = [{ value: "", label: "Choose a pattern" }, ...sorted.map((p) => ({ value: p.id, label: `${p.name} · ${p.team} · ${patternTimeLabel(p)}` }))]

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!person) return
    const p = state.patterns.find((x) => x.id === patternId)
    const next: typeof errors = {}
    if (!p) next.pattern = "Choose a pattern"
    if (!from) next.from = "Pick a start date"
    else if (p && activeAssignment(state, person.id, p.id, from)) next.pattern = `${person.name} already works ${p.name} on that date`
    if (next.pattern || next.from) return setErrors(next)
    onAssign(person, p!, from.slice(0, 10))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Assign shift</DialogTitle>
          <DialogDescription>{person ? `${person.name} works this pattern from the start date on.` : "Choose a shift pattern."}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Pattern" htmlFor="sh-assign-pat" error={errors.pattern} required>
            <FilterSelect label="Pattern" value={patternId} options={options} onChange={(v) => { setPatternId(v); setErrors((x) => ({ ...x, pattern: undefined })) }} />
          </Field>
          <Field label="Starts" htmlFor="sh-assign-from" error={errors.from} required>
            <DatePicker value={from} onChange={(v) => { setFrom(v); setErrors((x) => ({ ...x, from: undefined, pattern: undefined })) }} min={today} today={today} label="Starts" />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Assign</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
