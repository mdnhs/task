"use client"

import { useState } from "react"
import { toast } from "sonner"

import { FilterSeg } from "@/components/filter-bar"
import { useDept } from "@/hooks/use-dept"
import { Switch } from "@/components/ui/switch"
import { templateStore } from "../store"
import type { TemplateData } from "../types"

// Report template (FR-ORG-04, NFR-MAINT-01): per department, which sections are enabled and which fields are required.
// The tabs pick a department; the global department filter preselects it.
export function TemplatePanel({ data, canWrite, scopeKey }: { data: TemplateData; canWrite: boolean; scopeKey: string }) {
  const [depts, setDepts] = templateStore.useStore(data.departments, scopeKey)
  const global = useDept()
  const [picked, setPicked] = useState(data.departments[0]?.dept ?? "")
  const active = global !== "all" && depts.some((d) => d.dept === global) ? global : picked
  const current = depts.find((d) => d.dept === active)

  const patch = (sectionId: string, fn: (s: TemplateData["departments"][number]["sections"][number]) => TemplateData["departments"][number]["sections"][number]) =>
    setDepts((p) => p.map((d) => (d.dept === active ? { ...d, sections: d.sections.map((s) => (s.id === sectionId ? fn(s) : s)) } : d)))

  return (
    <section className="card set-card" aria-labelledby="set-tpl-h" data-readonly={canWrite ? undefined : ""}>
      <div className="card-head">
        <div>
          <h2 id="set-tpl-h">Report template</h2>
          <div className="sub">{current ? `${current.sections.filter((s) => s.enabled).length} of ${current.sections.length} sections enabled for ${current.dept}` : "No departments"}</div>
        </div>
        {global === "all" && depts.length > 1 && (
          <FilterSeg label="Department" value={picked} onChange={setPicked} options={depts.map((d) => ({ value: d.dept, label: d.dept }))} />
        )}
      </div>
      <ul className="set-list">
        {current?.sections.map((s, i) => (
          <li key={s.id} className="set-sec" data-off={s.enabled ? undefined : ""}>
            <div className="set-sec-head">
              <label className="set-switch-row">
                <Switch
                  checked={s.enabled}
                  disabled={!canWrite}
                  aria-label={`${s.title} section`}
                  onCheckedChange={(on) => {
                    patch(s.id, (x) => ({ ...x, enabled: on }))
                    toast.success(on ? "Section enabled" : "Section disabled", { description: `${i + 1}. ${s.title} for ${current.dept}` })
                  }}
                />
                <span className="set-sec-title"><span className="num">{i + 1}.</span> {s.title}</span>
              </label>
              <span className="set-sec-count num">{s.fields.filter((f) => f.required).length} of {s.fields.length} fields required</span>
            </div>
            {s.enabled && (
              <ul className="set-fields">
                {s.fields.map((f) => (
                  <li key={f.id}>
                    <label className="set-switch-row">
                      <Switch
                        checked={f.required}
                        disabled={!canWrite}
                        aria-label={`${f.label} required`}
                        onCheckedChange={(on) => patch(s.id, (x) => ({ ...x, fields: x.fields.map((y) => (y.id === f.id ? { ...y, required: on } : y)) }))}
                      />
                      <span>{f.label}</span>
                      <span className="set-req">{f.required ? "Required" : "Optional"}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
