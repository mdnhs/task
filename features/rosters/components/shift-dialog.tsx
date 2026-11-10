"use client"

import { ActionButton } from "@/components/action-button"
import { useState } from "react"
import { CalendarClock, Trash2, Users } from "lucide-react"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { FormSection, PeoplePicker } from "@/components/form-section"
import { TimePicker } from "@/components/time-picker"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { WorkforceMember } from "@/lib/workforce"
import { eligible, prunePeople, validateShiftForm, type ShiftErrors } from "../editing"
import type { RosterShift, ShiftTemplate } from "../types"

export type ShiftSave = { date: string; templateId: string; role: string; start: string; end: string; unpaidBreakMin: number; people: string[] }

// Add or edit shifts (FR-RS-20/22). Short enough for a dialog: shift, day and people on the left, times and break on the right.
// Adding takes several people (one shift each, they can differ later); editing is one shift, so one person. Only people holding
// the shift's required licence are suggested (FR-RS-04); the person already on an edited shift stays listed even if they'd no longer qualify.
export function ShiftDialog({ shift, date, templates, members, dates, onSave, onRemove, onClose }: {
  /** Set when editing. */
  shift?: RosterShift
  /** Day to add on. */
  date: string
  templates: ShiftTemplate[]
  members: WorkforceMember[]
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

  const tpl = templates.find((t) => t.id === templateId)
  const suggested = tpl ? eligible(members, tpl, day) : []
  const clear = (k: keyof ShiftErrors) => setErrors((e) => ({ ...e, [k]: undefined }))
  // A template or day change can make picks ineligible: remove them and say so, never drop them silently at save.
  const recheck = (t: ShiftTemplate | undefined, d: string) => {
    if (!t) return
    const keep = shift && shift.templateId === t.id && shift.date === d && shift.personId ? [shift.personId] : []
    const { kept, dropped } = prunePeople(people, members, t, d, keep)
    if (!dropped.length) return
    setPeople(kept)
    setPeopleError(`${dropped.map((id) => members.find((m) => m.id === id)?.name ?? "Someone").join(", ")} can't work this shift on ${dates.find((x) => x.value === d)?.label ?? d}. Choose again.`)
  }
  const pickTemplate = (id: string) => {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (t) { setStart(t.start); setEnd(t.end); setBrk(String(t.unpaidBreakMin)) }
    setErrors({})
    recheck(t, day)
  }
  const pickDay = (d: string) => { setDay(d); recheck(tpl, d) }
  const pickPeople = (v: string[]) => { setPeople(v); setPeopleError("") }
  const current = shift?.personId ? members.find((m) => m.id === shift.personId) : undefined
  const editPeople = current && !suggested.some((m) => m.id === current.id) ? [current, ...suggested] : suggested

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateShiftForm({ templateId, start, end, unpaidBreakMin: brk })
    setErrors(errs)
    const none = !shift && people.length === 0
    const stale = peopleError !== "" && people.length === 0
    if (none) setPeopleError("Choose at least one person")
    else if (stale) setPeopleError((p) => p || "Choose a person or Open shift")
    if (Object.keys(errs).length || !tpl || none || stale) return
    const ok = new Set(editPeople.map((m) => m.id))
    if (people.some((id) => !ok.has(id))) { setPeopleError("Someone picked can't work this shift. Choose again."); return }
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
              <FormSection icon={Users} title="Who and when">
                <Field label="Shift" htmlFor="sd-tpl" error={errors.templateId} required>
                  <FilterSelect
                    label="Shift"
                    value={templateId}
                    options={[{ value: "", label: "Choose a shift" }, ...templates.map((t) => ({ value: t.id, label: `${t.name} · ${t.start}–${t.end}` }))]}
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
                    <PeoplePicker label="People" people={suggested} value={people} onChange={pickPeople} />
                  </Field>
                )}
              </FormSection>
            </div>
            <div className="od-form-col">
              <FormSection icon={CalendarClock} title="Times">
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
                <Trash2 aria-hidden="true" />
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
