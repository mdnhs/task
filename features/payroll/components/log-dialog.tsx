"use client"

import { useState } from "react"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { TYPE, TYPE_ORDER } from "../types"
import type { IssueType, PayrollDirectory } from "../types"

const schema = z.object({
  description: z.string().trim().min(5, "Describe the issue in at least 5 characters").max(500, "Keep it under 500 characters"),
  target: z.string().min(1, "Choose a target date"),
})

export type NewIssue = { staff: string; type: IssueType; description: string; owner: string; target: string }

// Log a payroll issue. Issue tracking only: nothing here calculates pay.
export function LogDialog({
  directory,
  today,
  open,
  onOpenChange,
  onLog,
}: {
  directory: PayrollDirectory
  today: string
  open: boolean
  onOpenChange(o: boolean): void
  onLog(issue: NewIssue): void
}) {
  const [staff, setStaff] = useState(directory.staff[0]?.name ?? "")
  const [type, setType] = useState<IssueType>("missed_hours")
  const [owner, setOwner] = useState(directory.owners[0] ?? "")
  const [description, setDescription] = useState("")
  const [target, setTarget] = useState("")
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})

  function close(o: boolean) {
    onOpenChange(o)
    if (!o) {
      setDescription("")
      setTarget("")
      setErrors({})
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse({ description, target })
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) {
        const k = String(i.path[0])
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    onLog({ staff, type, owner, description: parsed.data.description, target: parsed.data.target })
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Log payroll issue</DialogTitle>
          <DialogDescription>Issue tracking only: no payroll calculation.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Staff member" htmlFor="pay-staff" required>
            <FilterSelect label="Staff member" value={staff} options={directory.staff.map((s) => ({ value: s.name, label: s.name }))} onChange={setStaff} />
          </Field>
          <Field label="Issue type" htmlFor="pay-type" required>
            <FilterSelect label="Issue type" value={type} options={TYPE_ORDER.map((t) => ({ value: t, label: TYPE[t] }))} onChange={(v) => setType(v as IssueType)} />
          </Field>
          <Field label="Description" htmlFor="pay-desc" error={errors.description} required>
            <Textarea id="pay-desc" value={description} onChange={(e) => { setDescription(e.target.value); setErrors((x) => ({ ...x, description: undefined })) }} />
          </Field>
          <Field label="Owner" htmlFor="pay-owner" required>
            <FilterSelect label="Owner" value={owner} options={directory.owners.map((o) => ({ value: o, label: o }))} onChange={setOwner} />
          </Field>
          <Field label="Target date" htmlFor="pay-target" error={errors.target} required>
            <DatePicker label="Target date" value={target} today={today} min={today.slice(0, 10)} placeholder="Pick a target date" onChange={(v) => { setTarget(v); setErrors((x) => ({ ...x, target: undefined })) }} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary">Log issue</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
