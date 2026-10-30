"use client"

import { useId } from "react"
import { motion } from "motion/react"

import { useField } from "@/components/field"
import { Icon } from "@/components/icons"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { layoutTransition } from "@/lib/motion"

type Option<V extends string> = { value: V; label: string }

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="od-filters">{children}</div>
}

export function FilterSearch({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder: string }) {
  return (
    <label className="od-filter-search">
      <Icon name="search" />
      <input type="search" value={value} placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function FilterSelect<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: V
  options: Option<V>[]
  onChange(v: V): void
}) {
  const field = useField() // inside a <Field>, the trigger carries the id and aria props
  return (
    <Select value={value} onValueChange={(v) => v !== null && onChange(v as V)}>
      <SelectTrigger
        className="od-filter-select"
        id={field?.id}
        aria-label={field ? undefined : label}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        aria-required={field?.required || undefined}
      >
        <SelectValue>{options.find((o) => o.value === value)?.label}</SelectValue>
      </SelectTrigger>
      <SelectContent className="od-menu" alignItemWithTrigger={false}>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function FilterSeg<V extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: V
  options: { value: V; label: React.ReactNode }[]
  onChange(v: V): void
}) {
  const id = useId()
  return (
    <div className="seg od-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="seg-ind" transition={layoutTransition} />}
          <span className="seg-lbl">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
