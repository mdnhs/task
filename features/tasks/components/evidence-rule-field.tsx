"use client"

import { Field } from "@/components/field"
import { FilterSeg, FilterSelect } from "@/components/filter-bar"
import { Input } from "@/components/ui/input"
import { DEFAULT_TYPES, EVIDENCE_TYPES, EVIDENCE_TYPE_LABEL, MAX_MIN, MODE_LABEL, REVIEW_LABEL, type EvidenceMode, type ReviewMode } from "@/lib/task-evidence"
import type { EvidenceRule, Person } from "../types"

const MODES: { value: EvidenceMode; label: string }[] = (["none", "optional", "required"] as const).map((m) => ({ value: m, label: MODE_LABEL[m] }))
const REVIEWS: { value: ReviewMode; label: string }[] = (["manager", "creator", "named", "auto"] as const).map((r) => ({ value: r, label: REVIEW_LABEL[r] }))

/** FR-M1-40/41/44: the evidence rule as form fields. Used by New task and by "Edit rule" on the task. */
export function EvidenceRuleField({ id, value, onChange, people, error }: { id: string; value: EvidenceRule; onChange(r: EvidenceRule): void; people: Person[]; error?: string }) {
  const set = (patch: Partial<EvidenceRule>) => onChange({ ...value, ...patch })
  const setMode = (mode: EvidenceMode) =>
    onChange({ ...value, mode, types: mode !== "none" && value.types.length === 0 ? [...DEFAULT_TYPES] : value.types, min: mode === "required" ? Math.max(1, value.min) : value.min })
  const toggle = (t: (typeof EVIDENCE_TYPES)[number]) => set({ types: value.types.includes(t) ? value.types.filter((x) => x !== t) : [...value.types, t] })
  return (
    <fieldset className="er-field" aria-describedby={error ? `${id}-err` : undefined}>
      <legend className="er-legend">Evidence of completion</legend>
      <FilterSeg label="Evidence rule" value={value.mode} options={MODES} onChange={setMode} />
      {value.mode === "none" ? (
        <p className="tpl-note">The assignee closes the task with one tap.</p>
      ) : (
        <>
          <div className="er-types" role="group" aria-label="Allowed evidence types">
            {EVIDENCE_TYPES.map((t) => (
              <button key={t} type="button" className="rp-day" aria-pressed={value.types.includes(t)} onClick={() => toggle(t)}>
                {EVIDENCE_TYPE_LABEL[t]}
                {t === "drive" && <span className="er-pc"> · PC only</span>}
              </button>
            ))}
          </div>
          <div className="od-row2">
            {value.mode === "required" && (
              <Field label="At least" htmlFor={`${id}-min`} hint={`1 to ${MAX_MIN} items`}>
                <Input id={`${id}-min`} type="number" inputMode="numeric" min={1} max={MAX_MIN} value={String(value.min)} onChange={(e) => set({ min: Number(e.target.value) })} />
              </Field>
            )}
            <Field label="Checked by" htmlFor={`${id}-review`}>
              <FilterSelect label="Checked by" value={value.review} options={REVIEWS} onChange={(r) => set({ review: r })} />
            </Field>
          </div>
          {value.review === "named" && (
            <Field label="Reviewer" htmlFor={`${id}-reviewer`}>
              <FilterSelect
                label="Reviewer"
                value={value.reviewer ?? ""}
                options={[{ value: "", label: "Choose…" }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
                onChange={(v) => set({ reviewer: v || undefined })}
              />
            </Field>
          )}
          <Field label="Instruction" htmlFor={`${id}-ins`}>
            <Input id={`${id}-ins`} placeholder="e.g. Wide photo of the cleaned area" value={value.instruction} maxLength={200} onChange={(e) => set({ instruction: e.target.value })} />
          </Field>
        </>
      )}
      {error && <p id={`${id}-err`} className="rp-err" role="alert">{error}</p>}
    </fieldset>
  )
}
