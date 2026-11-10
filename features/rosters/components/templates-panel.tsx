"use client"

import { ActionButton } from "@/components/action-button"
import { useState } from "react"
import { Save } from "lucide-react"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/dates"
import type { WeekTemplate } from "@/lib/roster-repeat"

const WEEKS_AHEAD = 8

// Saved week templates (FR-RS-27/28): save the shown week under a name, or start a week from a template. A template makes a new draft week,
// so only weeks with no roster yet are offered.
export function TemplatesPanel({ templates, locationName, canSave, onSave, onApply }: {
  templates: WeekTemplate[]
  locationName(id: string): string
  /** The shown location's week can be saved (a draft or published week with shifts at a location the role edits). */
  canSave: boolean
  onSave(name: string): void
  onApply(t: WeekTemplate): void
}) {
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  if (!canSave && !templates.length) return null
  return (
    <section className="card ros-panel" aria-label="Week templates">
      <div className="ros-panel-head">
        <h2>Week templates</h2>
        <span className="ros-sum num">{templates.length}</span>
      </div>
      {canSave && (
        <form className="ros-tpl-save" noValidate onSubmit={(e) => { e.preventDefault(); if (!name.trim()) { setError("Give the template a name"); return } onSave(name.trim()); setName("") }}>
          <Field label="Save the shown week as" htmlFor="wt-name" error={error || undefined}>
            <Input id="wt-name" placeholder="e.g. Standard week" value={name} onChange={(e) => { setName(e.target.value); setError("") }} />
          </Field>
          <button type="submit" className="btn btn-outline"><Save aria-hidden="true" />Save template</button>
        </form>
      )}
      {templates.length > 0 && (
        <ul className="ros-req-list">
          {templates.map((t) => (
            <li key={t.id} className="ros-tpl-row">
              <div className="ros-req-main">
                <span className="ros-who">{t.name}</span>
                <span className="ros-time num">{locationName(t.locationId)} · {t.shifts.length} shifts</span>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => onApply(t)}>Apply</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Pick the location and the week to start from a template. Only locations the role edits and weeks without a roster are offered. */
export function ApplyTemplateDialog({ template, locations, firstMonday, taken, onApply, onClose }: {
  template: WeekTemplate
  locations: { value: string; label: string }[]
  /** Monday of the week after today's. */
  firstMonday: string
  /** `${locationId}|${weekStart}` of weeks that already have a roster. */
  taken: Set<string>
  onApply(locationId: string, weekStart: string): void
  onClose(): void
}) {
  const [loc, setLoc] = useState(locations.find((l) => l.value === template.locationId)?.value ?? locations[0]?.value ?? "")
  const options = Array.from({ length: WEEKS_AHEAD }, (_, i) => addWeeks(firstMonday, i)).filter((d) => !taken.has(`${loc}|${d}`)).map((d) => ({ value: d, label: `Week of ${formatDate(d)}` }))
  const [week, setWeek] = useState("")
  const picked = options.some((o) => o.value === week) ? week : (options[0]?.value ?? "")
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Apply {template.name}</DialogTitle>
          <DialogDescription>Makes a draft week. People who can&apos;t work a shift become open shifts.</DialogDescription>
        </DialogHeader>
        <form className="od-form" noValidate onSubmit={(e) => { e.preventDefault(); if (loc && picked) onApply(loc, picked) }}>
          {locations.length > 1 && (
            <Field label="Location" htmlFor="at-loc"><FilterSelect label="Location" value={loc} options={locations} onChange={setLoc} /></Field>
          )}
          <Field label="Week" htmlFor="at-week" error={options.length ? undefined : "Every coming week here already has a roster"}>
            <FilterSelect label="Week" value={picked} options={options.length ? options : [{ value: "", label: "No free week" }]} onChange={setWeek} />
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <ActionButton type="submit" className="btn btn-primary" disabled={!loc || !picked}>Apply</ActionButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function addWeeks(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 7 * n)
  return t.toISOString().slice(0, 10)
}
