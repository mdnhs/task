"use client"

import { useRef, useState } from "react"
import { X } from "lucide-react"
import { motion } from "motion/react"
import { DUR, EASE } from "@/lib/motion"
import { useField } from "@/components/field"
import { Icon } from "@/components/icons"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { StretchIndicator } from "@/components/stretch-indicator"

type Option<V extends string> = { value: V; label: string }

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="od-filters">{children}</div>
}

// Flipping search (product owner's reference reel). Closed: a 48px brand circle with a search icon. Click it: the bar flips
// open around its horizontal axis (rotateX 90 to 0) while the circle glides to the right end (`layout="position"`) and
// turns over (rotateY) to an X. The X clears the query and flips it all back. Escape does the same; blurring away while
// empty closes it too. Transforms only, DUR.slow + EASE from lib/motion; reduced motion = instant (MotionConfig).
// Open, the disc sits inside the bar with a 4px gap all round: 40px of the 48px box.
const INSET = 40 / 48

export function FilterSearch({ value, onChange, placeholder }: { value: string; onChange(v: string): void; placeholder: string }) {
  const [open, setOpen] = useState(value !== "")
  // The box keeps its open width until the bar has flipped shut, so it closes at full width like the reference.
  const [wide, setWide] = useState(open)
  const input = useRef<HTMLInputElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const flip = { duration: DUR.slow, ease: EASE }
  const show = () => { setWide(true); setOpen(true); requestAnimationFrame(() => input.current?.focus()) }
  const hide = () => { if (value) onChange(""); setOpen(false); btn.current?.focus() }
  return (
    <div className="od-filter-search" data-open={wide || undefined} data-shut={!open || undefined}>
      <motion.label
        className="ofs-bar"
        initial={false}
        animate={{ rotateX: open ? 0 : 90 }}
        transition={flip}
        onAnimationComplete={() => { if (!open) setWide(false) }}
        aria-hidden={!open || undefined}
      >
        <input
          ref={input}
          type="search"
          value={value}
          placeholder={placeholder}
          aria-label={placeholder}
          tabIndex={open ? 0 : -1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); hide() } }}
          onBlur={(e) => { if (!value && e.relatedTarget !== btn.current) setOpen(false) }}
        />
      </motion.label>
      <motion.button
        ref={btn}
        type="button"
        layout="position"
        transition={flip}
        className="ofs-btn"
        aria-label={open ? "Clear and close search" : placeholder}
        aria-expanded={open}
        onClick={open ? hide : show}
      >
        <motion.span className="ofs-flip" initial={false} animate={{ rotateY: open ? 180 : 0, scale: open ? INSET : 1 }} transition={flip}>
          <span className="ofs-face"><Icon name="search" /></span>
          <span className="ofs-face ofs-face-back"><X aria-hidden="true" /></span>
        </motion.span>
      </motion.button>
    </div>
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
  return (
    <div className="seg od-seg" role="group" aria-label={label}>
      <StretchIndicator active={value} className="seg-ind stretch-ind" />
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          <span className="seg-lbl">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
