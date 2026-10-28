"use client"

import { Icon } from "@/components/icons"
import { Field } from "@/components/field"
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { FIELD_STATE } from "../types"
import type { FieldState, Report, ReportField, TemplateSection } from "../types"
import { FieldEntries } from "./field-entries"

const STATES = Object.keys(FIELD_STATE) as FieldState[]

// One collapsible section (§5.2). A restricted section the role cannot read shows a lock note instead of its fields.
export function ReportSection({
  section,
  report,
  errors,
  restricted,
  readOnly,
  extra,
  prefilled,
  onField,
}: {
  section: TemplateSection
  report: Report
  errors: Record<string, string>
  restricted: boolean
  readOnly?: boolean
  /** Rendered after the fields (review mode: section comments). */
  extra?: React.ReactNode
  /** Field key -> source, for answers filled from suggestions and not edited yet. */
  prefilled?: Record<string, string>
  onField(key: string, next: ReportField): void
}) {
  const filled = section.fields.filter((f) => report.fields[`${section.id}.${f.id}`]?.state).length
  const problems = section.fields.filter((f) => errors[`${section.id}.${f.id}`]).length
  return (
    <AccordionItem value={section.id} id={`sec-${section.id}`} className="rf-sec">
      <AccordionTrigger className="rf-sec-trigger">
        <span className="rf-sec-n">{section.n}</span>
        <span className="rf-sec-title">{section.title}</span>
        <span className="rf-sec-meta">
          {restricted ? (
            <span className="st mute">Restricted</span>
          ) : problems ? (
            <span className="st bad">{problems} to fix</span>
          ) : (
            <span className={`st ${filled === section.fields.length ? "ok" : "mute"}`}>
              {filled}/{section.fields.length}
            </span>
          )}
        </span>
      </AccordionTrigger>
      <AccordionContent className="rf-sec-body">
        {restricted ? (
          <p className="rf-restricted">
            <Icon name="lock" />
            Restricted section. {section.title} details are only visible to roles with access.
          </p>
        ) : (
          section.fields.map((f) => {
            const key = `${section.id}.${f.id}`
            const v: ReportField = report.fields[key] ?? { entries: [] }
            const needsEntries = v.state === "details" || v.state === "action_required"
            const id = `rf-${section.id}-${f.id}`
            return (
              <div key={key} className="rf-field">
                {prefilled?.[key] && (
                  <p className="rf-prefill-tag">
                    <span className="st info">Pre-filled</span>
                    from {prefilled[key].toLowerCase()}. Check it and edit if needed.
                  </p>
                )}
                <Field label={f.label} htmlFor={id} required={f.required} error={errors[key]} announce={false}>
                  <RadioGroup
                    id={id}
                    aria-label={f.label}
                    className="rf-states"
                    value={v.state ?? ""}
                    disabled={readOnly}
                    onValueChange={(val) => {
                      const state = val as FieldState
                      const wants = state === "details" || state === "action_required"
                      const entries = wants
                        ? v.entries.length
                          ? v.entries
                          : [{ id: `${key}-${Date.now().toString(36)}`, text: "", ...(f.entry === "structured" ? { cells: {} } : {}) }]
                        : []
                      onField(key, { state, entries })
                    }}
                  >
                    {STATES.map((s) => (
                      <label key={s} className="rf-state" data-checked={v.state === s ? "" : undefined}>
                        <RadioGroupItem value={s} aria-label={`${f.label}: ${FIELD_STATE[s]}`} />
                        {FIELD_STATE[s]}
                      </label>
                    ))}
                  </RadioGroup>
                </Field>
                {needsEntries && (
                  <FieldEntries field={f} label={f.label} entries={v.entries} disabled={readOnly} onChange={(entries) => onField(key, { ...v, entries })} />
                )}
              </div>
            )
          })
        )}
        {!restricted && extra}
      </AccordionContent>
    </AccordionItem>
  )
}
