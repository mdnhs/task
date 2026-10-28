"use client"

import { useState } from "react"
import { z } from "zod"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { INCIDENT_TYPE } from "../types"
import type { IncidentType, StaffMember } from "../types"
import { fieldErrors } from "./dialog-util"

const schema = z.object({
  type: z.enum(["callout", "noshow", "cover", "staff_issue"], { message: "Choose a type" }),
  staff: z.string().min(1, "Choose the staff member"),
  site: z.string().trim().min(2, "Enter the site").max(80, "Keep the site under 80 characters"),
  client: z.string().trim().min(2, "Enter the client").max(80, "Keep the client under 80 characters"),
  shift: z.string().trim().min(2, "Enter the shift or subject").max(40, "Keep it under 40 characters"),
  action: z.string().trim().min(3, "Enter the next action").max(160, "Keep the action under 160 characters"),
  contact: z.string().trim().max(40),
  notes: z.string().trim().max(500, "Keep the notes under 500 characters"),
})
export type IncidentInput = z.output<typeof schema>
type Form = z.input<typeof schema>
type Errors = Partial<Record<keyof Form, string>>

const TYPES = (Object.keys(INCIDENT_TYPE) as IncidentType[]).map((t) => ({ value: t, label: INCIDENT_TYPE[t] }))

export function IncidentDialog({
  open,
  onOpenChange,
  staff,
  onCreate,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  staff: StaffMember[]
  onCreate(v: IncidentInput): void
}) {
  const blank = (): Form => ({ type: "callout", staff: "", site: "", client: "", shift: "", action: "", contact: "", notes: "" })
  const [form, setForm] = useState<Form>(blank)
  const [errors, setErrors] = useState<Errors>({})
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setForm(blank())
      setErrors({})
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse(form)
    if (!parsed.success) return setErrors(fieldErrors<keyof Form>(parsed.error))
    onCreate(parsed.data)
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Log incident</DialogTitle>
          <DialogDescription>Record a call-out, no-show, cover request or staff issue.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <div className="od-row2">
            <Field label="Type" htmlFor="sr-type" error={errors.type} required>
              <FilterSelect label="Type" value={form.type} options={TYPES} onChange={(v) => set("type", v)} />
            </Field>
            <Field label="Staff member" htmlFor="sr-staff" error={errors.staff} required>
              <FilterSelect
                label="Staff member"
                value={form.staff}
                options={[{ value: "", label: "Choose…" }, ...staff.map((s) => ({ value: s.name, label: s.name }))]}
                onChange={(v) => set("staff", v)}
              />
            </Field>
          </div>
          <div className="od-row2">
            <Field label="Site" htmlFor="sr-site" error={errors.site} required>
              <Input id="sr-site" value={form.site} onChange={(e) => set("site", e.target.value)} />
            </Field>
            <Field label="Client" htmlFor="sr-client" error={errors.client} required>
              <Input id="sr-client" value={form.client} onChange={(e) => set("client", e.target.value)} />
            </Field>
          </div>
          <Field label="Shift or subject" htmlFor="sr-shift" error={errors.shift} hint="For example 22:00–06:00, or Licence" required>
            <Input id="sr-shift" value={form.shift} onChange={(e) => set("shift", e.target.value)} />
          </Field>
          <Field label="Next action" htmlFor="sr-action" error={errors.action} required>
            <Input id="sr-action" value={form.action} onChange={(e) => set("action", e.target.value)} />
          </Field>
          <Field label="Contact (optional)" htmlFor="sr-contact" hint="Visible only to roles with staff write access">
            <Input id="sr-contact" value={form.contact} onChange={(e) => set("contact", e.target.value)} />
          </Field>
          <Field label="Notes (optional)" htmlFor="sr-notes" error={errors.notes}>
            <Textarea id="sr-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Log incident</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
