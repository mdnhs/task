"use client"

import { useId, useState } from "react"
import { CalendarIcon } from "lucide-react"

import { useField } from "@/components/field"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TimePicker } from "@/components/time-picker"
import { formatDate } from "@/lib/dates"

// Date picker: a Calendar in a Popover. Values are plain strings, never Date objects or UTC conversions:
// "YYYY-MM-DD", or "YYYY-MM-DDTHH:mm" with `withTime` (adds a TimePicker beside the trigger).
// Inside a <Field> the trigger carries the id and aria-describedby, like FilterSelect.

const pad = (n: number) => String(n).padStart(2, "0")
const toDate = (v: string) => {
  const [y, m, d] = v.slice(0, 10).split("-").map((n) => parseInt(n, 10))
  return y && m && d ? new Date(y, m - 1, d) : undefined
}
const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const PRESETS = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "In a week", days: 7 },
  { label: "In 2 weeks", days: 14 },
]

export function DatePicker({
  value,
  onChange,
  min,
  today,
  placeholder = "Pick a date",
  label = "Date",
  withTime = false,
  defaultTime = "17:00",
}: {
  value: string
  onChange(v: string): void
  /** Earliest selectable day, "YYYY-MM-DD" (a longer ISO is cut to the day). */
  min?: string
  /** The tenant's "today" ("YYYY-MM-DD" or longer ISO) that the quick picks (Today, Tomorrow, …) count from. Pass org.today; falls back to the device date. */
  today?: string
  placeholder?: string
  /** Accessible name when used outside a <Field>. */
  label?: string
  withTime?: boolean
  /** Time given to a freshly picked day when `withTime` and no time is set yet. */
  defaultTime?: string
}) {
  const field = useField()
  const [open, setOpen] = useState(false)
  const popId = useId()
  const day = value.slice(0, 10)
  const time = value.slice(11, 16)
  const selected = day ? toDate(day) : undefined
  const minDate = min ? toDate(min) : undefined
  // Popup content only renders once opened (client side), so the device-date fallback can't cause a hydration mismatch.
  const base = (today && toDate(today)) || new Date()
  const presets = PRESETS.map((p) => {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + p.days)
    return { ...p, date: d, day: toDay(d), off: !!minDate && d < minDate }
  })

  function pick(d: Date | undefined) {
    if (!d) return
    onChange(withTime ? `${toDay(d)}T${time || defaultTime}` : toDay(d))
    setOpen(false)
  }

  return (
    <div className="od-datepick-wrap">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              role="combobox"
              aria-haspopup="dialog"
              aria-expanded={open}
              aria-controls={open ? popId : undefined}
              className="od-datepick"
              id={field?.id}
              aria-label={field ? undefined : label}
              aria-describedby={field?.describedBy}
              aria-invalid={field?.invalid || undefined}
              aria-required={field?.required || undefined}
            />
          }
        >
          <CalendarIcon aria-hidden="true" />
          <span className={day ? undefined : "od-datepick-ph"}>{day ? formatDate(`${day}T00:00:00`) : placeholder}</span>
        </PopoverTrigger>
        <PopoverContent id={popId} className="od-pop" align="start" sideOffset={6}>
          <Calendar
            mode="single"
            selected={selected}
            onSelect={pick}
            defaultMonth={selected ?? minDate}
            disabled={minDate ? { before: minDate } : undefined}
            weekStartsOn={1}
          />
          <div className="od-date-presets" role="group" aria-label="Quick picks">
            {presets.map((p) => (
              <button
                key={p.days}
                type="button"
                className="od-date-preset"
                aria-pressed={p.day === day}
                disabled={p.off}
                onClick={() => pick(p.date)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {withTime && <TimePicker label={`${label} time`} value={time} disabled={!day} onChange={(t) => day && onChange(`${day}T${t}`)} />}
    </div>
  )
}
