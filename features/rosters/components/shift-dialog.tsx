"use client"

import { ActionButton } from "@/components/action-button"
import { useState } from "react"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { FormSection, PeoplePicker } from "@/components/form-section"
import { TimePicker } from "@/components/time-picker"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { validateShiftForm, type ShiftErrors } from "../editing"
import type { RosterMember, ShiftType } from "../types"
import type { ViewShift } from "../view"
import { Icon } from "@/components/icon"

export type ShiftSave = { date: string; templateId: string; role: string; start: string; end: string; unpaidBreakMin: number; people: string[] }

// Add or edit shifts (FR-RS-20/22). Short enough for a dialog: shift, day and people on the left, times and break on the right.
// Adding takes several people (one shift each, they can differ later); editing is one shift, so one person. Who can work which shift (licences) is the API's call: a refusal comes back as a toast (422 ineligible).
export function ShiftDialog({ shift, date, types, members, dates, onSave, onRemove, onClose }: {
  /** Set when editing. */
  shift?: ViewShift
  /** Day to add on. */
  date: string
  /** The shift types of the location (the API's list; archived ones are not offered). */
  types: ShiftType[]
  members: RosterMember[]
  /** The days of the shift's own week: a shift never moves to another week. */
  dates: { value: string; label: string }[]
  onSave(v: ShiftSave): void
  /** Edit mode only: remove the shift (the caller decides whether a reason is needed). */
  onRemove?(): void
  onClose(): void
}) {
  const [day, setDay] = useState(shift?.date ?? date)
  const [templateId, setTemplateId] = useState(shift?.templateId ?? "")
  const [start, setStart] = useState(shift?.start ?? "")
  const [end, setEnd] = useState(shift?.end ?? "")
  const [brk, setBrk] = useState(shift ? String(shift.unpaidBreakMin) : "")
  const [people, setPeople] = useState<string[]>(shift?.personId ? [shift.personId] : [])
  const [errors, setErrors] = useState<ShiftErrors>({})
  const [peopleError, setPeopleError] = useState("")

  const tpl = types.find((t) => t.id === templateId)
  const pickable = members.filter((m) => m.active)
  const clear = (k: keyof ShiftErrors) => setErrors((e) => ({ ...e, [k]: undefined }))
  const pickTemplate = (id: string) => {
    setTemplateId(id)
    const t = types.find((x) => x.id === id)
    if (t) { setStart(t.start); setEnd(t.end); setBrk(String(t.unpaidBreakMin)) }
    setErrors({})
  }
  const pickDay = (d: string) => setDay(d)
  const pickPeople = (v: string[]) => { setPeople(v); setPeopleError("") }
  // The person already on an edited shift stays listed even if they are no longer active.
  const current = shift?.personId && !pickable.some((m) => m.id === shift.personId) ? [{ id: shift.personId, name: shift.person }] : []
  const editPeople = [...current, ...pickable]

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateShiftForm({ templateId, start, end, unpaidBreakMin: brk })
    setErrors(errs)
    const none = !shift && people.length === 0
    if (none) setPeopleError("Choose at least one person")
    if (Object.keys(errs).length || !tpl || none) return
    onSave({ date: day, templateId, role: shift && shift.templateId === templateId ? shift.role : tpl.role, start, end, unpaidBreakMin: Number(brk), people })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog ros-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{shift ? "Edit shift" : "Add shift"}</DialogTitle>
          <DialogDescription>{shift ? "Change the person, day or times." : "Add one or more people to a shift. Each gets their own times."}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <div className="od-form-cols">
            <div className="od-form-col">
              <FormSection icon="users" title="Who and when">
                <Field label="Shift" htmlFor="sd-tpl" error={errors.templateId} required>
                  <FilterSelect
                    label="Shift"
                    value={templateId}
                    options={[{ value: "", label: "Choose a shift" }, ...types.map((t) => ({ value: t.id, label: `${t.name} · ${t.start}–${t.end}` }))]}
                    onChange={pickTemplate}
                  />
                </Field>
                <Field label="Day" htmlFor="sd-day">
                  <FilterSelect label="Day" value={day} options={dates} onChange={pickDay} />
                </Field>
                {shift ? (
                  <Field label="Person" htmlFor="sd-person" error={peopleError || undefined} hint={tpl && tpl.requires.length ? `Needs ${tpl.requires.join(", ")}` : undefined}>
                    <FilterSelect
                      label="Person"
                      value={people[0] ?? ""}
                      options={[{ value: "", label: "Open shift" }, ...editPeople.map((m) => ({ value: m.id, label: m.name }))]}
                      onChange={(v) => pickPeople(v ? [v] : [])}
                    />
                  </Field>
                ) : (
                  <Field label="People" htmlFor="sd-people" error={peopleError || undefined} hint={tpl && tpl.requires.length ? `Needs ${tpl.requires.join(", ")}` : undefined}>
                    <PeoplePicker label="People" people={editPeople} value={people} onChange={pickPeople} />
                  </Field>
                )}
              </FormSection>
            </div>
            <div className="od-form-col">
              <FormSection icon="calendar-clock" title="Times">
                <div className="od-row2">
                  <Field label="Start" htmlFor="sd-start" error={errors.start} required>
                    <TimePicker label="Start" value={start} onChange={(v) => { setStart(v); clear("start") }} />
                  </Field>
                  <Field label="End" htmlFor="sd-end" error={errors.end} required>
                    <TimePicker label="End" value={end} onChange={(v) => { setEnd(v); clear("end") }} />
                  </Field>
                </div>
                <Field label="Break (min)" htmlFor="sd-break" error={errors.unpaidBreakMin} required>
                  <Input id="sd-break" inputMode="numeric" placeholder="e.g. 30" value={brk} onChange={(e) => { setBrk(e.target.value.replace(/\D/g, "")); clear("unpaidBreakMin") }} />
                </Field>
              </FormSection>
            </div>
          </div>
          <div className="od-form-foot">
            {shift && onRemove && (
              <button type="button" className="btn btn-outline ros-remove" onClick={onRemove}>
                <Icon name="trash" size={24} />
                Remove shift
              </button>
            )}
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary">{shift ? "Save changes" : "Add shift"}</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
