"use client"

import { useState } from "react"
import { AlarmClock } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { formatDate, formatTime } from "@/lib/dates"
import type { Person, Task } from "../types"

type Overdue = NonNullable<Task["overdue"]>

// FR-TASK-09: an overdue open task needs a reason, a next action, an owner and a revised due date.
const schema = (now: string) =>
  z.object({
    reason: z.string().trim().min(3, "Say why this is overdue"),
    nextAction: z.string().trim().min(3, "Say what happens next"),
    owner: z.string().min(1, "Choose who is responsible"),
    revisedDue: z
      .string()
      .min(1, "Choose a revised due date")
      .refine((v) => v.length < 16 || `${v}:00` > now, "The revised due date must be in the future"),
  })
type Form = z.input<ReturnType<typeof schema>>

export function OverdueForm({
  overdue,
  people,
  defaultOwner,
  now,
  canEdit,
  onSave,
}: {
  overdue?: Overdue
  people: Person[]
  defaultOwner: string
  now: string
  canEdit: boolean
  onSave(o: Overdue): void
}) {
  const [form, setForm] = useState<Form>({
    reason: overdue?.reason ?? "",
    nextAction: overdue?.nextAction ?? "",
    owner: overdue?.owner ?? defaultOwner,
    revisedDue: overdue?.revisedDue.slice(0, 16) ?? "",
  })
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  if (!canEdit) {
    if (!overdue) return null
    return (
      <section className="card" aria-labelledby="td-overdue-h">
        <h2 id="td-overdue-h" className="td-h">Overdue update</h2>
        <dl className="td-meta">
          <div><dt>Reason</dt><dd>{overdue.reason}</dd></div>
          <div><dt>Next action</dt><dd>{overdue.nextAction}</dd></div>
          <div><dt>Responsible</dt><dd>{overdue.owner}</dd></div>
          <div><dt>Revised due</dt><dd>{formatDate(overdue.revisedDue)} {formatTime(overdue.revisedDue)}</dd></div>
        </dl>
      </section>
    )
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = schema(now).safeParse(form)
    if (!r.success) {
      const next: typeof errors = {}
      for (const i of r.error.issues) {
        const k = i.path[0] as keyof Form
        if (!next[k]) next[k] = i.message
      }
      return setErrors(next)
    }
    const v = r.data
    onSave({ reason: v.reason, nextAction: v.nextAction, owner: v.owner, revisedDue: v.revisedDue.length === 10 ? `${v.revisedDue}T17:00:00` : `${v.revisedDue}:00` })
    toast.success("Overdue update saved")
  }

  return (
    <section className="card td-overdue" aria-labelledby="td-overdue-h">
      <h2 id="td-overdue-h" className="td-h td-overdue-h">
        <span className="fs-sec-i td-overdue-i" aria-hidden="true"><AlarmClock /></span>
        This task is overdue
      </h2>
      <form className="td-form" onSubmit={submit} noValidate>
        <Field label="Reason" htmlFor="od-reason" error={errors.reason} required>
          <Textarea id="od-reason" placeholder="e.g. Waiting for the contractor" value={form.reason} onChange={(e) => set("reason", e.target.value)} />
        </Field>
        <Field label="Next action" htmlFor="od-next" error={errors.nextAction} required>
          <Input id="od-next" placeholder="e.g. Call the contractor at 10:00" value={form.nextAction} onChange={(e) => set("nextAction", e.target.value)} />
        </Field>
        <Field label="Owner" htmlFor="od-owner" error={errors.owner} required>
          <FilterSelect
            label="Owner"
            value={form.owner}
            options={[{ value: "", label: "Choose…" }, ...people.map((p) => ({ value: p.name, label: p.name }))]}
            onChange={(v) => set("owner", v)}
          />
        </Field>
        <Field label="New due date" htmlFor="od-revised" error={errors.revisedDue} required>
          <DatePicker value={form.revisedDue} onChange={(v) => set("revisedDue", v)} min={now.slice(0, 10)} today={now} withTime label="New due date" placeholder="Pick a date" />
        </Field>
        <div className="td-form-foot"><button type="submit" className="btn btn-primary">Save update</button></div>
      </form>
    </section>
  )
}
