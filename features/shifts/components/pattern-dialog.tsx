"use client"

import { useMemo, useState } from "react"
import { z } from "zod"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { FoldToggle, FormFold } from "@/components/form-section"
import { TimePicker } from "@/components/time-picker"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { WEEKDAY_SHORT, crossesMidnight, isHm, isTimeZone } from "@/lib/shifts"
import type { ShiftPattern, Weekday } from "@/lib/shifts"

const ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0]

type Form = { name: string; team: string; start: string; end: string; days: Weekday[]; timeZone: string }
type Errors = Partial<Record<keyof Form, string>>

function fieldErrors(error: z.ZodError): Errors {
  const out: Errors = {}
  for (const i of error.issues) {
    const k = i.path[0] as keyof Form
    if (!out[k]) out[k] = i.message
  }
  return out
}

/** IANA zones offered in the picker: the workspace zone first, then every zone the runtime knows. */
function zoneOptions(tz: string) {
  let all: string[] = []
  try {
    all = Intl.supportedValuesOf("timeZone")
  } catch {
    all = []
  }
  return [{ value: "", label: `Workspace time zone (${tz})` }, ...all.filter((z) => z !== tz).map((z) => ({ value: z, label: z }))]
}

// Create or edit a shift pattern (FR-M1-20): name, team, start, end, days and an optional own time zone.
export function PatternDialog({
  pattern,
  open,
  onOpenChange,
  teams,
  patterns,
  tz,
  defaultTeam,
  onSave,
}: {
  /** Undefined = create. */
  pattern: ShiftPattern | undefined
  open: boolean
  onOpenChange(o: boolean): void
  teams: string[]
  /** All patterns, to keep names unique per team. */
  patterns: ShiftPattern[]
  /** Workspace (tenant) time zone. */
  tz: string
  defaultTeam: string
  onSave(v: Omit<ShiftPattern, "id">, id?: string): void
}) {
  const initial = (): Form => ({
    name: pattern?.name ?? "",
    team: pattern?.team ?? defaultTeam,
    start: pattern?.start ?? "",
    end: pattern?.end ?? "",
    days: pattern?.days ?? [1, 2, 3, 4, 5],
    timeZone: pattern?.timeZone && pattern.timeZone !== tz ? pattern.timeZone : "",
  })
  const [form, setForm] = useState<Form>(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [showZone, setShowZone] = useState(() => !!initial().timeZone)
  const [seen, setSeen] = useState({ id: pattern?.id, open })
  // Reload the form when the dialog opens or another pattern is opened.
  if (seen.id !== pattern?.id || seen.open !== open) {
    setSeen({ id: pattern?.id, open })
    if (open) {
      setForm(initial())
      setErrors({})
      setShowZone(!!initial().timeZone)
    }
  }
  const zones = useMemo(() => zoneOptions(tz), [tz])

  const schema = z
    .object({
      name: z.string().trim().min(2, "Enter a name").max(60, "Keep the name under 60 characters"),
      team: z.string().refine((t) => teams.includes(t), "Choose a team"),
      start: z.string().refine(isHm, "Pick a start time"),
      end: z.string().refine(isHm, "Pick an end time"),
      days: z.array(z.number()).min(1, "Pick at least one day"),
      timeZone: z.string().refine((t) => !t || isTimeZone(t), "Choose a valid time zone"),
    })
    .refine((v) => !patterns.some((p) => p.id !== pattern?.id && p.team === v.team && p.name.trim().toLowerCase() === v.name.trim().toLowerCase()), {
      path: ["name"],
      message: "This team already has a pattern with that name",
    })

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }
  const toggleDay = (d: Weekday) => set("days", form.days.includes(d) ? form.days.filter((x) => x !== d) : [...form.days, d].sort())

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse(form)
    if (!parsed.success) return setErrors(fieldErrors(parsed.error))
    const v = parsed.data
    onSave({ name: v.name, team: v.team, start: v.start, end: v.end, days: form.days, ...(v.timeZone ? { timeZone: v.timeZone } : {}) }, pattern?.id)
    onOpenChange(false)
  }

  const night = isHm(form.start) && isHm(form.end) && crossesMidnight(form)
  // The time zone is rarely changed: folded unless the pattern has its own zone; an error inside opens it.
  const zoneOpen = showZone || !!errors.timeZone
  const endHint = night ? (form.start === form.end ? "A 24-hour shift: ends at this time the next day." : "Ends the next day (night shift).") : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{pattern ? "Edit shift pattern" : "New shift pattern"}</DialogTitle>
          <DialogDescription>A shift belongs to the day it starts.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <div className="od-row2">
            <Field label="Name" htmlFor="sh-name" error={errors.name} required>
              <Input id="sh-name" placeholder="e.g. Early" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Team" htmlFor="sh-team" error={errors.team} required>
              <FilterSelect label="Team" value={form.team} options={teams.map((t) => ({ value: t, label: t }))} onChange={(v) => set("team", v)} />
            </Field>
          </div>
          <div className="od-row2">
            <Field label="Start" htmlFor="sh-start" error={errors.start} required>
              <TimePicker value={form.start} onChange={(v) => set("start", v)} label="Start" defaultTime="07:00" />
            </Field>
            <Field label="End" htmlFor="sh-end" error={errors.end} hint={errors.end ? undefined : endHint} required>
              <TimePicker value={form.end} onChange={(v) => set("end", v)} label="End" defaultTime="15:00" />
            </Field>
          </div>
          <div className="od-field" data-invalid={errors.days ? "" : undefined}>
            <span className="sh-days-label" id="sh-days-l">
              Days<span className="od-req" aria-hidden="true"> *</span>
            </span>
            <div className="sh-days" role="group" aria-labelledby="sh-days-l" aria-describedby={errors.days ? "sh-days-msg" : undefined}>
              {ORDER.map((d) => (
                <button key={d} type="button" className="sh-day-btn" aria-pressed={form.days.includes(d)} onClick={() => toggleDay(d)}>
                  {WEEKDAY_SHORT[d]}
                </button>
              ))}
            </div>
            {errors.days && (
              <div className="od-field-msg is-enter">
                <p id="sh-days-msg" className="od-field-err" role="alert">{errors.days}</p>
              </div>
            )}
          </div>
          <div className="sh-zone">
            <FoldToggle open={zoneOpen} onToggle={() => setShowZone((v) => !v)} controls="sh-tz-fold" label={`Time zone · ${form.timeZone || tz}`} />
          </div>
          <FormFold id="sh-tz-fold" open={zoneOpen}>
            <Field label="Time zone" htmlFor="sh-tz" error={errors.timeZone} hint="Only for a site in another time zone">
              <FilterSelect label="Time zone" value={form.timeZone} options={zones} onChange={(v) => set("timeZone", v)} />
            </Field>
          </FormFold>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">{pattern ? "Save" : "Create pattern"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
