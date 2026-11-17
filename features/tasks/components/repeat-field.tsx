"use client"

import { DatePicker } from "@/components/date-picker"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Input } from "@/components/ui/input"
import type { RepeatRule } from "../types"

export type RepeatValue = RepeatRule["freq"] | "none"

export type RepeatDraft = { freq: RepeatValue; days: number[]; dayOfMonth: string; until: string; patternId: string }
export const NO_REPEAT: RepeatDraft = { freq: "none", days: [], dayOfMonth: "", until: "", patternId: "" }
/** A shift pattern the API lists (GET /v1/shifts): the choice for "Every shift". */
export type PatternChoice = { id: string; label: string }

const FREQ = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
]
// Monday first, values are 0 (Sun) to 6 (Sat).
const DAYS = [["Mon", 1], ["Tue", 2], ["Wed", 3], ["Thu", 4], ["Fri", 5], ["Sat", 6], ["Sun", 0]] as const

export const draftToRule = (d: RepeatDraft): RepeatRule | undefined =>
  d.freq === "none"
    ? undefined
    : {
        freq: d.freq,
        ...(d.freq === "weekly" ? { days: [...d.days].sort((a, b) => a - b) } : {}),
        ...(d.freq === "monthly" ? { dayOfMonth: Number(d.dayOfMonth) } : {}),
        ...(d.freq === "per_shift" ? { patternId: d.patternId } : {}),
        ...(d.until ? { until: d.until } : {}),
      }

export const ruleToDraft = (r?: RepeatRule): RepeatDraft =>
  r ? { freq: r.freq, days: r.days ?? [], dayOfMonth: r.dayOfMonth ? String(r.dayOfMonth) : "", until: r.until ?? "", patternId: r.patternId ?? "" } : NO_REPEAT

// FR-TASK-10 repeat rule inputs. `id` prefixes the control ids so two of these never clash on a page.
export function RepeatField({
  id,
  value,
  onChange,
  today,
  min,
  error,
  patterns = [],
}: {
  id: string
  value: RepeatDraft
  onChange(v: RepeatDraft): void
  today: string
  /** Earliest end date: the first due date. */
  min?: string
  error?: string
  /** The shift patterns the API lists. "Every shift" is offered only when there is at least one (the shifts data may not be available). */
  patterns?: PatternChoice[]
}) {
  const set = (p: Partial<RepeatDraft>) => onChange({ ...value, ...p })
  return (
    <div className="rp-field">
      <Field label="Repeat" htmlFor={`${id}-freq`}>
        <FilterSelect label="Repeat" value={value.freq} options={(patterns.length || value.freq === "per_shift" ? [...FREQ, { value: "per_shift", label: "Every shift" }] : FREQ) as { value: RepeatValue; label: string }[]} onChange={(v) => set({ freq: v })} />
      </Field>
      {value.freq === "weekly" && (
        <div className="rp-days" role="group" aria-label="Repeat on" id={`${id}-days`}>
          {DAYS.map(([label, n]) => {
            const on = value.days.includes(n)
            return (
              <button
                key={n}
                type="button"
                className="rp-day"
                aria-pressed={on}
                onClick={() => set({ days: on ? value.days.filter((d) => d !== n) : [...value.days, n] })}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}
      {value.freq === "per_shift" && (
        <Field label="Shift" htmlFor={`${id}-pattern`} hint="One copy per shift of the assignee, from the shift's own days">
          <FilterSelect label="Shift" value={value.patternId} options={[{ value: "", label: "Choose a shift…" }, ...patterns.map((p) => ({ value: p.id, label: p.label }))]} onChange={(v) => set({ patternId: v })} />
        </Field>
      )}
      {value.freq === "monthly" && (
        <Field label="Day of month" htmlFor={`${id}-dom`} hint="Short months use their last day">
          <Input id={`${id}-dom`} inputMode="numeric" placeholder="e.g. 15" value={value.dayOfMonth} onChange={(e) => set({ dayOfMonth: e.target.value.replace(/\D/g, "").slice(0, 2) })} />
        </Field>
      )}
      {value.freq !== "none" && (
        <>
          <Field label="Ends" htmlFor={`${id}-until`}>
            <DatePicker label="End date" value={value.until} today={today} min={min} placeholder="Never" onChange={(v) => set({ until: v })} />
          </Field>
          {value.until && <button type="button" className="rp-clear" onClick={() => set({ until: "" })}>Clear end date</button>}
        </>
      )}
      {error && value.freq !== "none" && <p className="rp-err" role="alert">{error}</p>}
    </div>
  )
}
