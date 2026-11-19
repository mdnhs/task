"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { createLeave } from "@/app/actions/rosters"
import { ActionButton } from "@/components/action-button"
import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FormSection } from "@/components/form-section"
import { LEAVE_KINDS, validateLeave, type LeaveErrors } from "../self-service"

// FR-RS-41: the signed-in person asks for leave on the API. It waits for a decision (D8); an overlap with their own open or approved leave, a bad range and the rest are the API's to refuse,
// shown in one short line.
export function LeaveForm({ today }: { today: string }) {
  const router = useRouter()
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [kind, setKind] = useState<string>(LEAVE_KINDS[0].value)
  const [errors, setErrors] = useState<LeaveErrors>({})
  const [failed, setFailed] = useState("")
  const busy = useRef(false)

  async function submit(): Promise<boolean> {
    if (busy.current) return false
    const errs = validateLeave({ from, to, kind })
    setErrors(errs)
    setFailed("")
    if (Object.keys(errs).length) return false
    busy.current = true
    try {
      const r = await createLeave({ from, to, kind })
      if (!r.ok) {
        setFailed(r.error.toast?.text ?? "Not sent.")
        return false
      }
      toast.success("Leave requested")
      setFrom("")
      setTo("")
      router.refresh()
      return true
    } finally {
      busy.current = false
    }
  }

  return (
    <FormSection icon="plane" title="Request leave">
      <form className="mr-form" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="od-row2">
          <Field label="From" htmlFor="lv-from" error={errors.from} required>
            <DatePicker label="From" value={from} min={today} today={today} onChange={(v) => { setFrom(v); setFailed(""); setErrors((x) => ({ ...x, from: undefined })) }} />
          </Field>
          <Field label="To" htmlFor="lv-to" error={errors.to} required>
            <DatePicker label="To" value={to} min={from || today} today={today} onChange={(v) => { setTo(v); setFailed(""); setErrors((x) => ({ ...x, to: undefined })) }} />
          </Field>
        </div>
        <div className="od-field">
          <span className="fs-label">Type</span>
          <div className="er-types" role="group" aria-label="Leave type">
            {LEAVE_KINDS.map((k) => (
              <button key={k.value} type="button" className="rp-day" aria-pressed={kind === k.value} onClick={() => setKind(k.value)}>{k.label}</button>
            ))}
          </div>
        </div>
        {failed && <p className="rl-err" role="alert">{failed}</p>}
        <ActionButton className="btn btn-primary mr-add" onAction={submit}>Request leave</ActionButton>
      </form>
    </FormSection>
  )
}
