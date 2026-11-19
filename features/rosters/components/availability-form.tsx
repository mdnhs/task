"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { setAvailability } from "@/app/actions/rosters"
import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { FormSection } from "@/components/form-section"
import { Icon } from "@/components/icon"
import { TimePicker, formatTime } from "@/components/time-picker"
import type { Availability } from "@/lib/roster-rules"
import type { Weekday } from "@/lib/shifts"
import { DAYS } from "../admin"
import { validateAvailability, windowsBody } from "../self-service"

const label = (d: number) => DAYS.find((x) => x.day === d)?.label ?? ""
/** "24:00" (the API's end of day) reads as midnight. */
const time = (t: string) => (t === "24:00" ? "Midnight" : formatTime(t))

// FR-RS-40: the signed-in person's weekly "not available" windows, saved on the API as one whole set (PUT replaces it at once). An overnight window comes back as two rows split at midnight.
// The rule check flags a shift that lands in one.
export function AvailabilityForm({ windows }: { windows: Availability[] }) {
  const router = useRouter()
  const [weekday, setWeekday] = useState<Weekday>(1)
  const [from, setFrom] = useState("09:00")
  const [to, setTo] = useState("17:00")
  const [error, setError] = useState("")
  const busy = useRef(false)

  async function put(body: ReturnType<typeof windowsBody>, done: string): Promise<boolean> {
    if (busy.current) return false
    busy.current = true
    try {
      const r = await setAvailability(body)
      if (!r.ok) {
        setError(r.error.toast?.text ?? "Not saved.")
        return false
      }
      toast.success(done)
      router.refresh()
      return true
    } finally {
      busy.current = false
    }
  }
  async function add(): Promise<boolean> {
    const f = { weekday, from, to }
    const err = validateAvailability(f, windows)
    setError(err ?? "")
    if (err) return false
    return put(windowsBody(windows, { add: f }), "Window added")
  }

  const shown = [...windows].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.from.localeCompare(b.from))
  return (
    <FormSection icon="ban" title="Not available" note={windows.length ? String(windows.length) : undefined}>
      <form className="mr-form" onSubmit={(e) => e.preventDefault()} noValidate>
        <div className="od-field">
          <span className="fs-label">Day</span>
          <div className="er-types" role="group" aria-label="Day">
            {DAYS.map((d) => (
              <button key={d.day} type="button" className="rp-day" aria-pressed={weekday === d.day} onClick={() => { setWeekday(d.day as Weekday); setError("") }}>{d.label}</button>
            ))}
          </div>
        </div>
        <div className="od-row2">
          <Field label="From" htmlFor="av-from">
            <TimePicker label="From" value={from} onChange={(v) => { setFrom(v); setError("") }} />
          </Field>
          <Field label="To" htmlFor="av-to">
            <TimePicker label="To" value={to} onChange={(v) => { setTo(v); setError("") }} defaultTime="17:00" />
          </Field>
        </div>
        {error && <p className="rl-err" role="alert">{error}</p>}
        <ActionButton className="btn btn-outline mr-add" onAction={add}><Icon name="plus" size={24} />Add window</ActionButton>
      </form>
      {shown.length === 0 ? (
        <p className="rl-empty">No windows set.</p>
      ) : (
        <ul className="mr-chips">
          {shown.map((a) => (
            <li key={`${a.weekday}-${a.from}-${a.to}`} className="mr-chip">
              <span><b>{label(a.weekday)}</b> <span className="num">{time(a.from)} to {time(a.to)}</span></span>
              <button type="button" className="fs-act bad" aria-label={`Remove ${label(a.weekday)} ${a.from} window`} onClick={() => void put(windowsBody(windows, { drop: a }), "Window removed")}>
                <Icon name="trash" size={24} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </FormSection>
  )
}
