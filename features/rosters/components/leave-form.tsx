"use client"

import { ActionButton } from "@/components/action-button"
import { useState } from "react"
import { Plane } from "lucide-react"
import { toast } from "sonner"

import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FormSection } from "@/components/form-section"
import { leaveStore } from "../store"
import { newLeaveId, validateLeave, type LeaveErrors } from "../self-service"
import type { LeaveQueue, MyRosterData } from "../types"

export const LEAVE_KINDS = ["Annual leave", "Sick leave", "Unpaid leave", "Other"]

// FR-RS-41: the signed-in person asks for leave. It starts as "requested" and waits for a decision (D8).
export function LeaveForm({ me, today, scopeKey, data, queue }: { me: string; today: string; scopeKey: string; data: MyRosterData; queue: LeaveQueue }) {
  const [, setLeave] = leaveStore.useStore([...data.leave, ...queue.leave.filter((q) => !data.leave.some((l) => l.id === q.id))], scopeKey)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [kind, setKind] = useState(LEAVE_KINDS[0])
  const [errors, setErrors] = useState<LeaveErrors>({})

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateLeave({ from, to, kind })
    setErrors(errs)
    if (Object.keys(errs).length) return
    setLeave((p) => [...p, { id: newLeaveId(), personId: me, from, to, kind, status: "requested", decidedBy: null, decidedAt: null }])
    toast.success("Leave requested")
    setFrom("")
    setTo("")
  }

  return (
    <FormSection icon={Plane} title="Request leave">
      <form className="mr-form" onSubmit={submit} noValidate>
        <div className="od-row2">
          <Field label="From" htmlFor="lv-from" error={errors.from} required>
            <DatePicker label="From" value={from} today={today} onChange={(v) => { setFrom(v); setErrors((x) => ({ ...x, from: undefined })) }} />
          </Field>
          <Field label="To" htmlFor="lv-to" error={errors.to} required>
            <DatePicker label="To" value={to} min={from || today} today={today} onChange={(v) => { setTo(v); setErrors((x) => ({ ...x, to: undefined })) }} />
          </Field>
        </div>
        <div className="od-field">
          <span className="fs-label">Type</span>
          <div className="er-types" role="group" aria-label="Leave type">
            {LEAVE_KINDS.map((k) => (
              <button key={k} type="button" className="rp-day" aria-pressed={kind === k} onClick={() => setKind(k)}>{k}</button>
            ))}
          </div>
        </div>
        <ActionButton type="submit" className="btn btn-primary mr-add">Request leave</ActionButton>
      </form>
    </FormSection>
  )
}
