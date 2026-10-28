"use client"

import { useState } from "react"
import { z } from "zod"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

const schema = z.object({
  name: z.string().trim().min(2, "Enter the candidate's name").max(80, "Keep the name under 80 characters"),
  role: z.string().trim().min(2, "Enter the role applied for").max(80, "Keep the role under 80 characters"),
  dept: z.string().min(1, "Choose a department"),
  owner: z.string().min(1, "Choose an owner"),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z.string().trim().min(6, "Enter a phone number").max(24, "Phone number is too long"),
  nextAction: z.string().trim().max(120, "Keep it under 120 characters"),
})
type Form = z.infer<typeof schema>

export type NewCandidateInput = Form

export function AddCandidateDialog({
  open,
  onOpenChange,
  departments,
  owners,
  defaultDept,
  onAdd,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  departments: string[]
  owners: string[]
  defaultDept: string
  onAdd(input: NewCandidateInput): void
}) {
  const blank = (): Form => ({ name: "", role: "", dept: defaultDept, owner: "", email: "", phone: "", nextAction: "" })
  const [form, setForm] = useState<Form>(blank)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
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
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof Form
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    onAdd(parsed.data)
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Add candidate</DialogTitle>
          <DialogDescription>New candidates start at the Applied stage. Contact details are only visible to recruitment and management users.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <div className="od-row2">
            <Field label="Name" htmlFor="rc-name" error={errors.name} required>
              <Input id="rc-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Role applied" htmlFor="rc-role" error={errors.role} required>
              <Input id="rc-role" value={form.role} onChange={(e) => set("role", e.target.value)} />
            </Field>
          </div>
          <div className="od-row2">
            <Field label="Department" htmlFor="rc-dept" error={errors.dept} required>
              <FilterSelect label="Department" value={form.dept} options={departments.map((d) => ({ value: d, label: d }))} onChange={(v) => set("dept", v)} />
            </Field>
            <Field label="Owner" htmlFor="rc-owner" error={errors.owner} required>
              <FilterSelect label="Owner" value={form.owner} options={[{ value: "", label: "Choose…" }, ...owners.map((o) => ({ value: o, label: o }))]} onChange={(v) => set("owner", v)} />
            </Field>
          </div>
          <div className="od-row2">
            <Field label="Email" htmlFor="rc-email" error={errors.email} required>
              <Input id="rc-email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </Field>
            <Field label="Phone" htmlFor="rc-phone" error={errors.phone} required>
              <Input id="rc-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </Field>
          </div>
          <Field label="Next action (optional)" htmlFor="rc-next" error={errors.nextAction}>
            <Input id="rc-next" value={form.nextAction} onChange={(e) => set("nextAction", e.target.value)} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Add candidate</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
