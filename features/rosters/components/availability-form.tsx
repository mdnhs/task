"use client"

import { useState } from "react"

import { Field } from "@/components/field"
import { FormSection } from "@/components/form-section"
import { TimePicker, formatTime } from "@/components/time-picker"
import type { Weekday } from "@/lib/shifts"
import { availabilityStore } from "../store"
import type { MyRosterData } from "../types"
import { splitAvailability, validateAvailability } from "../self-service"
import { Icon } from "@/components/icon"

const DAYS: { day: Weekday; label: string }[] = [{ day: 1, label: "Mon" }, { day: 2, label: "Tue" }, { day: 3, label: "Wed" }, { day: 4, label: "Thu" }, { day: 5, label: "Fri" }, { day: 6, label: "Sat" }, { day: 0, label: "Sun" }]

// FR-RS-40: the signed-in person's weekly "not available" windows. The rule check flags a shift that lands in one.
export function AvailabilityForm({ me, scopeKey, data }: { me: string; scopeKey: string; data: MyRosterData }) {
  const [all, setAll] = availabilityStore.useStore(data.availability, scopeKey)
  const mine = all.filter((a) => a.personId === me)
  const [weekday, setWeekday] = useState<Weekday>(1)
  const [from, setFrom] = useState("09:00")
  const [to, setTo] = useState("17:00")
  const [error, setError] = useState("")

  function add(e: React.FormEvent) {
    e.preventDefault()
    const err = validateAvailability({ weekday, from, to }, me, mine)
    setError(err ?? "")
    if (err) return
    setAll((p) => [...p, ...splitAvailability(me, { weekday, from, to })])
  }

  const shown = [...mine].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.from.localeCompare(b.from))
  return (
    <FormSection icon="ban" title="Not available">
      <form className="mr-form" onSubmit={add} noValidate>
        <div className="od-field">
          <span className="fs-label">Day</span>
          <div className="er-types" role="group" aria-label="Day">
            {DAYS.map((d) => (
              <button key={d.day} type="button" className="rp-day" aria-pressed={weekday === d.day} onClick={() => setWeekday(d.day)}>{d.label}</button>
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
        <button type="submit" className="btn btn-outline mr-add"><Icon name="plus" size={24} />Add window</button>
      </form>
      {shown.length === 0 ? (
        <p className="rl-empty">No windows set.</p>
      ) : (
        <ul className="mr-chips">
          {shown.map((a, i) => (
            <li key={`${a.weekday}-${a.from}-${a.to}-${i}`} className="mr-chip">
              <span><b>{DAYS.find((d) => d.day === a.weekday)?.label}</b> <span className="num">{formatTime(a.from)} to {formatTime(a.to)}</span></span>
              <button type="button" className="fs-act bad" aria-label={`Remove ${DAYS.find((d) => d.day === a.weekday)?.label} window`} onClick={() => setAll((p) => p.filter((x) => x !== a))}>
                <Icon name="trash" size={24} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </FormSection>
  )
}
