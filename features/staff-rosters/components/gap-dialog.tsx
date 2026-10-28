"use client"

import { useState } from "react"
import { z } from "zod"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { COVERAGE } from "../types"
import type { Coverage, RosterGap, StaffMember } from "../types"
import { fieldErrors } from "./dialog-util"

const schema = z
  .object({
    coverage: z.enum(["covered", "partial", "uncovered"]),
    assigned: z.string(),
    nextAction: z.string().trim().min(3, "Enter the next action").max(160, "Keep the action under 160 characters"),
  })
  .refine((v) => v.coverage === "uncovered" || v.assigned.length > 0, { path: ["assigned"], message: "Choose who is assigned" })
  .refine((v) => v.coverage !== "uncovered" || v.assigned.length === 0, { path: ["coverage"], message: "Uncovered means nobody is assigned" })
type Form = z.input<typeof schema>
type Errors = Partial<Record<keyof Form, string>>

const COVERAGES = (Object.keys(COVERAGE) as Coverage[]).map((c) => ({ value: c, label: COVERAGE[c].label }))

// Update a roster gap: who is assigned, how well it is covered, and the next action (FR-ROSTER-02/03).
export function GapDialog({
  gap,
  open,
  onOpenChange,
  staff,
  onSave,
}: {
  gap: RosterGap | undefined
  open: boolean
  onOpenChange(o: boolean): void
  staff: StaffMember[]
  onSave(id: string, v: { coverage: Coverage; assigned: string; nextAction: string }): void
}) {
  const initial = (): Form => ({ coverage: gap?.coverage ?? "uncovered", assigned: gap?.assigned ?? "", nextAction: gap?.nextAction ?? "" })
  const [form, setForm] = useState<Form>(initial)
  const [errors, setErrors] = useState<Errors>({})
  const [seen, setSeen] = useState(gap?.id)
  // Reload the form when another gap is opened.
  if (seen !== gap?.id) {
    setSeen(gap?.id)
    setForm(initial())
    setErrors({})
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined, ...(k === "coverage" || k === "assigned" ? { coverage: undefined, assigned: undefined } : {}) }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!gap) return
    const parsed = schema.safeParse(form)
    if (!parsed.success) return setErrors(fieldErrors<keyof Form>(parsed.error))
    onSave(gap.id, parsed.data)
    onOpenChange(false)
  }

  // Cancel/Escape/outside click discards abandoned edits so reopening the same gap starts clean.
  function handleOpenChange(o: boolean) {
    if (!o) {
      setForm(initial())
      setErrors({})
    }
    onOpenChange(o)
  }

  const options = staff.filter((s) => !gap || s.dept === gap.dept)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Update cover</DialogTitle>
          <DialogDescription>{gap ? `${gap.site} · ${gap.role}, ${gap.time}.` : "Update who is covering this shift."}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <div className="od-row2">
            <Field label="Coverage" htmlFor="sr-cov" error={errors.coverage} required>
              <FilterSelect label="Coverage" value={form.coverage} options={COVERAGES} onChange={(v) => set("coverage", v)} />
            </Field>
            <Field label="Assigned" htmlFor="sr-assigned" error={errors.assigned}>
              <FilterSelect
                label="Assigned"
                value={form.assigned}
                options={[{ value: "", label: "Nobody" }, ...options.map((s) => ({ value: s.name, label: s.name }))]}
                onChange={(v) => set("assigned", v)}
              />
            </Field>
          </div>
          <Field label="Next action" htmlFor="sr-gap-action" error={errors.nextAction} required>
            <Input id="sr-gap-action" value={form.nextAction} onChange={(e) => set("nextAction", e.target.value)} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
