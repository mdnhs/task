"use client"

import { useState } from "react"
import { z } from "zod"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { Incident, StaffMember } from "../types"
import { fieldErrors } from "./dialog-util"

const schema = z.object({
  cover: z.string().min(1, "Choose who is covering"),
  action: z.string().trim().min(3, "Enter the next action").max(160, "Keep the action under 160 characters"),
})
type Form = z.input<typeof schema>
type Errors = Partial<Record<keyof Form, string>>

// Record cover for a call-out, no-show or cover request: marks it covered.
export function CoverDialog({
  incident,
  open,
  onOpenChange,
  staff,
  onSave,
}: {
  incident: Incident | undefined
  open: boolean
  onOpenChange(o: boolean): void
  staff: StaffMember[]
  onSave(id: string, cover: string, action: string): void
}) {
  const [form, setForm] = useState<Form>({ cover: "", action: "" })
  const [errors, setErrors] = useState<Errors>({})
  const set = <K extends keyof Form>(k: K, v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setForm({ cover: "", action: "" })
      setErrors({})
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!incident) return
    const parsed = schema.safeParse(form)
    if (!parsed.success) return setErrors(fieldErrors<keyof Form>(parsed.error))
    onSave(incident.id, parsed.data.cover, parsed.data.action)
    close(false)
  }

  const options = staff.filter((s) => s.name !== incident?.staff && (!incident || s.dept === incident.dept))

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Record cover</DialogTitle>
          <DialogDescription>{incident ? `${incident.staff} · ${incident.site}, ${incident.shift}.` : "Choose who is covering."}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Covered by" htmlFor="sr-cover" error={errors.cover} required>
            <FilterSelect
              label="Covered by"
              value={form.cover}
              options={[{ value: "", label: "Choose…" }, ...options.map((s) => ({ value: s.name, label: s.name }))]}
              onChange={(v) => set("cover", v)}
            />
          </Field>
          <Field label="Next action" htmlFor="sr-cover-action" error={errors.action} required>
            <Input id="sr-cover-action" value={form.action} onChange={(e) => set("action", e.target.value)} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Save cover</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
