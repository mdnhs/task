"use client"

import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { Person } from "@/lib/types"

const schema = z.object({
  title: z.string().trim().min(3, "Enter a title of at least 3 characters").max(120, "Keep the title under 120 characters"),
  assignee: z.string().min(1, "Choose an assignee"),
  due: z.string().min(1, "Choose a due date"),
})
type Form = z.input<typeof schema>

// Next reference, computed locally: features never import each other, so this does not touch the tasks store (FR-REV-02).
// Starts well above the seeded task refs (up to TSK-1042) so mock refs do not collide.
let counter = 9000

// Assign follow-up task (FR-REV-02): the mock only confirms with a toast.
export function FollowUpDialog({
  open,
  onOpenChange,
  people,
  today,
  reportTitle,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  people: Person[]
  today: string
  reportTitle: string
}) {
  const blank = (): Form => ({ title: "", assignee: "", due: "" })
  const [form, setForm] = useState<Form>(blank)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const set = (k: keyof Form, v: string) => {
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
    counter += 1
    toast.success(`Follow-up TSK-${counter} created`)
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Assign follow-up task</DialogTitle>
          <DialogDescription>Create a task from {reportTitle} for someone to act on.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Title" htmlFor="fu-title" error={errors.title} required>
            <Input id="fu-title" value={form.title} onChange={(e) => set("title", e.target.value)} />
          </Field>
          <div className="od-row2">
            <Field label="Assignee" htmlFor="fu-assignee" error={errors.assignee} required>
              <FilterSelect
                label="Assignee"
                value={form.assignee}
                options={[{ value: "", label: "Choose…" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                onChange={(v) => set("assignee", v)}
              />
            </Field>
            <Field label="Due date" htmlFor="fu-due" error={errors.due} required>
              <DatePicker label="Due date" value={form.due} today={today} min={today.slice(0, 10)} placeholder="Pick a due date" onChange={(v) => set("due", v)} />
            </Field>
          </div>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Create task</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
