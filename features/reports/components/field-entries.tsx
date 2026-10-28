"use client"

import { X } from "lucide-react"

import { Icon } from "@/components/icons"
import { Input } from "@/components/ui/input"
import type { ReportEntry, TemplateField } from "../types"

// The entries behind a "details" / "action required" state: add, edit and remove. Structured fields show their columns.
export function FieldEntries({
  field,
  label,
  entries,
  disabled,
  onChange,
}: {
  field: TemplateField
  label: string
  entries: ReportEntry[]
  disabled?: boolean
  onChange(next: ReportEntry[]): void
}) {
  const cols = field.entry === "structured" ? (field.columns ?? []) : []
  const update = (i: number, patch: Partial<ReportEntry>) => onChange(entries.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  const setCell = (i: number, col: string, v: string) => {
    const cells = { ...entries[i].cells, [col]: v }
    update(i, { cells, text: cols.map((c) => cells[c]).filter(Boolean).join(", ") })
  }
  return (
    <div className="rf-entries">
      {entries.map((e, i) => (
        <div key={e.id} className="rf-entry">
          <div className="rf-entry-fields" data-cols={cols.length || 1}>
            {cols.length ? (
              cols.map((c) => (
                <Input
                  key={c}
                  aria-label={`${label}: ${c} (entry ${i + 1})`}
                  placeholder={c}
                  value={e.cells?.[c] ?? ""}
                  disabled={disabled}
                  onChange={(ev) => setCell(i, c, ev.target.value)}
                />
              ))
            ) : (
              <Input
                aria-label={`${label}: entry ${i + 1}`}
                placeholder={field.entry === "count" ? "Number" : "Details"}
                inputMode={field.entry === "count" ? "numeric" : undefined}
                value={e.text}
                disabled={disabled}
                onChange={(ev) => update(i, { text: field.entry === "count" ? ev.target.value.replace(/\D/g, "") : ev.target.value })}
              />
            )}
          </div>
          {!disabled && (
            <button type="button" className="rf-entry-x" aria-label={`Remove entry ${i + 1} from ${label}`} onClick={() => onChange(entries.filter((_, j) => j !== i))}>
              <X aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <button
          type="button"
          className="rf-add"
          onClick={() => onChange([...entries, { id: `e-${Date.now().toString(36)}-${entries.length}`, text: "", ...(cols.length ? { cells: {} } : {}) }])}
        >
          <Icon name="plus" />
          Add entry
        </button>
      )}
    </div>
  )
}
