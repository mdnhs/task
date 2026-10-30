"use client"

import { ChevronDown, X, type LucideIcon } from "lucide-react"

import { FilterSelect } from "@/components/filter-bar"

// Shared form building blocks (ui-rules.md → Forms). The New task page is the reference layout.

/** One titled group of a form: a small icon chip and a heading (with an optional note or action on the right), then its fields. */
export function FormSection({ icon: Icon, title, note, action, className, children }: { icon: LucideIcon; title: string; note?: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <section className={className ? `fs-sec ${className}` : "fs-sec"} aria-label={title}>
      <h3 className="fs-sec-h">
        <span className="fs-sec-i" aria-hidden="true"><Icon /></span>
        {title}
        {note && <span className="fs-opt">{note}</span>}
        {action}
      </h3>
      {children}
    </section>
  )
}

/** Small "Optional" tag for a label row or legend. */
export const OptionalTag = () => <span className="fs-opt">Optional</span>

/** Heading action that folds a FormFold open and shut. `label` names what is inside while it is closed. */
export function FoldToggle({ open, onToggle, controls, label }: { open: boolean; onToggle(): void; controls: string; label: string }) {
  return (
    <button type="button" className="fs-act" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {open ? "Hide" : label}
      <ChevronDown aria-hidden="true" className="fs-chev" />
    </button>
  )
}

/** Optional or advanced fields, folded shut by default (grid rows 0fr→1fr). Closed content is inert. */
export function FormFold({ id, open, children }: { id: string; open: boolean; children: React.ReactNode }) {
  return (
    <div id={id} className="fs-fold" data-open={open || undefined} inert={!open}>
      <div className="fs-fold-in">{children}</div>
    </div>
  )
}

type Person = { id: string; name: string }

/** Pick several people without listing everyone: an "Add a person…" select, then a removable chip per chosen person. */
export function PeoplePicker({ people, value, onChange, label, exclude = [] }: { people: Person[]; value: string[]; onChange(v: string[]): void; label: string; exclude?: string[] }) {
  const chosen = value.filter((id) => !exclude.includes(id)).flatMap((id) => people.filter((p) => p.id === id))
  return (
    <>
      <FilterSelect
        label={label}
        value=""
        options={[{ value: "", label: "Add a person…" }, ...people.filter((p) => !exclude.includes(p.id) && !value.includes(p.id)).map((p) => ({ value: p.id, label: p.name }))]}
        onChange={(v) => v && onChange([...value, v])}
      />
      {chosen.length > 0 && (
        <ul className="fs-people" aria-label={label}>
          {chosen.map((p) => (
            <li key={p.id}>
              {p.name}
              <button type="button" aria-label={`Remove ${p.name}`} onClick={() => onChange(value.filter((x) => x !== p.id))}>
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
