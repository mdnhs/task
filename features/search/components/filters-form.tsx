"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"

import { Field } from "@/components/field"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate } from "@/lib/dates"

import { LAYER_ATTR } from "../containment"
import { TYPE_LABELS, countFilters, humanStatus } from "../match"
import type { FilterKey, SearchFilters, SearchType } from "../types"

// Nested popups (Select, date range) are portalled to <body>. They carry LAYER_ATTR so the search popover's
// outside-press and focus-out checks (isInsideSearch) treat them as inside.

const ANY = "__any"
const pad = (n: number) => String(n).padStart(2, "0")
const toDate = (v: string) => {
  const [y, m, d] = v.slice(0, 10).split("-").map((n) => parseInt(n, 10))
  return y && m && d ? new Date(y, m - 1, d) : undefined
}
const toDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fmt = (day: string) => formatDate(`${day}T00:00:00`)

/** Range presets counted from the tenant's today. Exported for tests. */
export function rangePresets(today: string) {
  const t = toDate(today) ?? new Date()
  const at = (days: number) => toDay(new Date(t.getFullYear(), t.getMonth(), t.getDate() + days))
  return [
    { label: "Today", from: at(0), to: at(0) },
    { label: "Last 7 days", from: at(-6), to: at(0) },
    { label: "Next 7 days", from: at(0), to: at(6) },
    { label: "Last 30 days", from: at(-29), to: at(0) },
    {
      label: "This month",
      from: toDay(new Date(t.getFullYear(), t.getMonth(), 1)),
      to: toDay(new Date(t.getFullYear(), t.getMonth() + 1, 0)),
    },
  ]
}

function SearchSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const all = [{ value: ANY, label: "Any" }, ...options]
  const v = value || ANY
  return (
    <Select value={v} onValueChange={(x) => x !== null && onChange(x === ANY ? "" : String(x))} disabled={options.length === 0}>
      <SelectTrigger id={id} className="od-search-ctl">
        <SelectValue>{all.find((o) => o.value === v)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent className="od-menu" alignItemWithTrigger={false} {...{ [LAYER_ATTR]: "" }}>
        {all.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function DateRange({
  id,
  from,
  to,
  today,
  onChange,
}: {
  id: string
  from: string
  to: string
  today: string
  onChange: (from: string, to: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const label = from && to ? (from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`) : from ? `From ${fmt(from)}` : to ? `Until ${fmt(to)}` : ""
  const presets = rangePresets(today)
  const selected = { from: from ? toDate(from) : undefined, to: to ? toDate(to) : undefined }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" id={id} className="od-datepick od-search-ctl" aria-haspopup="dialog" />}>
        <CalendarIcon aria-hidden="true" />
        <span className={label ? undefined : "od-datepick-ph"}>{label || "Any date"}</span>
      </PopoverTrigger>
      <PopoverContent className="od-pop" align="start" sideOffset={6} {...{ [LAYER_ATTR]: "" }}>
        <Calendar
          mode="range"
          selected={selected}
          onSelect={(r) => onChange(r?.from ? toDay(r.from) : "", r?.to ? toDay(r.to) : "")}
          defaultMonth={selected.from ?? toDate(today)}
          weekStartsOn={1}
        />
        <div className="od-date-presets" role="group" aria-label="Quick ranges">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              className="od-date-preset"
              aria-pressed={p.from === from && p.to === to}
              onClick={() => {
                onChange(p.from, p.to)
                setOpen(false)
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function FiltersForm({
  filters,
  departments,
  owners,
  statuses,
  types,
  today,
  onChange,
  onRange,
  onReset,
  onDone,
}: {
  filters: SearchFilters
  departments: string[]
  owners: string[]
  statuses: string[]
  types: SearchType[]
  today: string
  onChange: (k: FilterKey, v: string) => void
  onRange: (from: string, to: string) => void
  onReset: () => void
  onDone: () => void
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => ref.current?.querySelector<HTMLElement>("button")?.focus(), [])
  const opt = (xs: string[], show: (v: string) => string = (v) => v) => xs.map((v) => ({ value: v, label: show(v) }))

  return (
    <div
      ref={ref}
      className="od-search-filters"
      role="group"
      aria-label="Search filters"
      onKeyDown={(e) => {
        // React events bubble out of portals: ignore Esc from an open Select / calendar (it closes itself).
        if (e.key === "Escape" && ref.current?.contains(e.target as Node)) {
          e.preventDefault()
          e.stopPropagation()
          onDone()
        }
      }}
    >
      <Field label="Date range" htmlFor="od-sf-date">
        <DateRange id="od-sf-date" from={filters.from} to={filters.to} today={today} onChange={onRange} />
      </Field>
      <div className="od-search-frow">
        {departments.length > 0 && (
          <Field label="Department" htmlFor="od-sf-dept">
            <SearchSelect id="od-sf-dept" value={filters.dept} options={opt(departments)} onChange={(v) => onChange("dept", v)} />
          </Field>
        )}
        <Field label="Type" htmlFor="od-sf-type">
          <SearchSelect
            id="od-sf-type"
            value={filters.type}
            options={opt(types, (v) => TYPE_LABELS[v as SearchType])}
            onChange={(v) => onChange("type", v)}
           
          />
        </Field>
        <Field label="Owner" htmlFor="od-sf-owner">
          <SearchSelect id="od-sf-owner" value={filters.owner} options={opt(owners)} onChange={(v) => onChange("owner", v)} />
        </Field>
        <Field label="Status" htmlFor="od-sf-status">
          <SearchSelect id="od-sf-status" value={filters.status} options={opt(statuses, humanStatus)} onChange={(v) => onChange("status", v)} />
        </Field>
      </div>
      <div className="od-search-factions">
        <button type="button" className="od-search-link" onClick={onReset} disabled={countFilters(filters) === 0}>
          Reset
        </button>
        <button type="button" className="od-search-done" onClick={onDone}>
          Show results
        </button>
      </div>
    </div>
  )
}
