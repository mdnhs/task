"use client"

import { useEffect, useId, useRef, useState } from "react"
import { Clock } from "lucide-react"

import { useField } from "@/components/field"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// Time picker: hour / minute / AM-PM columns in a Popover, styled like DatePicker (shadcn has no time picker,
// and the native <input type="time"> popup ignores the theme). Value is a plain 24h "HH:mm" string, "" when unset.
// Inside a <Field> the trigger carries the id and aria-describedby, like DatePicker.

const pad = (n: number) => String(n).padStart(2, "0")
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)

export function formatTime(v: string) {
  const [h, m] = v.split(":").map((n) => parseInt(n, 10))
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "AM" : "PM"}`
}

export function TimePicker({
  value,
  onChange,
  disabled,
  placeholder = "Pick a time",
  label = "Time",
  step = 5,
  defaultTime = "09:00",
}: {
  value: string
  onChange(v: string): void
  disabled?: boolean
  placeholder?: string
  /** Accessible name when used outside a <Field>. */
  label?: string
  /** Minute interval offered in the minutes column. */
  step?: number
  /** Starting point when the first column is picked with no value yet. */
  defaultTime?: string
}) {
  const field = useField()
  const [open, setOpen] = useState(false)
  const popId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const [h24, min] = (value || defaultTime).split(":").map((n) => parseInt(n, 10))
  const hour = h24 % 12 || 12
  const pm = h24 >= 12
  const minutes = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step)
  if (value && !minutes.includes(min)) {
    minutes.push(min)
    minutes.sort((a, b) => a - b)
  }

  const set = (h: number, m: number, isPm: boolean) => onChange(`${pad((h % 12) + (isPm ? 12 : 0))}:${pad(m)}`)

  // Bring the selected cell of each column into view when the popup opens (scrolls the column only, not the page).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => {
      listRef.current?.querySelectorAll<HTMLElement>("[aria-selected='true']").forEach((el) => {
        const col = el.parentElement!
        col.scrollTop = el.offsetTop - col.clientHeight / 2 + el.offsetHeight / 2
      })
    })
    return () => cancelAnimationFrame(id)
  }, [open])

  const cell = (key: string | number, text: string, selected: boolean, pick: () => void) => (
    <button key={key} type="button" role="option" aria-selected={selected} className="od-time-cell" onClick={pick}>
      {text}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            role="combobox"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={open ? popId : undefined}
            className="od-datepick od-timepick"
            id={field?.id}
            aria-label={field ? undefined : label}
            aria-describedby={field?.describedBy}
            aria-invalid={field?.invalid || undefined}
            aria-required={field?.required || undefined}
          />
        }
      >
        <Clock aria-hidden="true" />
        <span className={value ? undefined : "od-datepick-ph"}>{value ? formatTime(value) : placeholder}</span>
      </PopoverTrigger>
      <PopoverContent id={popId} className="od-pop" align="start" sideOffset={6}>
        <div ref={listRef} className="od-time">
          <div role="listbox" aria-label="Hour" className="od-time-col">
            {HOURS.map((h) => cell(h, String(h), !!value && h === hour, () => set(h, value ? min : 0, pm)))}
          </div>
          <div role="listbox" aria-label="Minute" className="od-time-col">
            {minutes.map((m) => cell(m, pad(m), !!value && m === min, () => set(hour, m, pm)))}
          </div>
          <div role="listbox" aria-label="AM or PM" className="od-time-col od-time-ampm">
            {cell("am", "AM", !!value && !pm, () => set(hour, value ? min : 0, false))}
            {cell("pm", "PM", !!value && pm, () => set(hour, value ? min : 0, true))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
