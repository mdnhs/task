"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { FilterSeg } from "@/components/filter-bar"
import { useDept } from "@/hooks/use-dept"
import { useApiAction } from "@/hooks/use-api-action"
import { Switch } from "@/components/ui/switch"
import { apiBrowser } from "@/lib/api/browser"
import { ApiError } from "@/lib/api/problem"
import type { TemplateData } from "../types"
import { makeSettingsClient } from "../client"

const SAVE_MS = 500

// Shift report template (FR-M1-25, was FR-ORG-04) on the API (B6 T6.7): per team (a department is matched to a team by NAME), which sections are enabled and which fields are required.
// `GET/PUT /v1/shift-reports/template`: every change updates the screen at once and ONE save (500 ms after the last change) replaces the whole template; what the API answers is what stays
// (the department names follow a team rename). A refusal reverts to what the API holds and says why: 422 invalid_template with its field messages, 422 template_too_large (64 KB), 409
// template_dept_exists. It applies to NEW submissions only.
// The tabs pick a department; the global department filter preselects it.
export function TemplatePanel({ data, canWrite }: { data: TemplateData; canWrite: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const [depts, setDepts] = useState(data.departments)
  const known = useRef(data.departments)
  const latest = useRef(data.departments)
  const note = useRef("")
  const timer = useRef<number | undefined>(undefined)
  const saving = useRef(false)
  const again = useRef(false)
  const global = useDept()
  const [picked, setPicked] = useState(data.departments[0]?.dept ?? "")
  const active = global !== "all" && depts.some((d) => d.dept === global) ? global : picked
  const current = depts.find((d) => d.dept === active)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function flush() {
    if (saving.current) {
      again.current = true
      return
    }
    saving.current = true
    try {
      do {
        again.current = false
        const body = latest.current
        const r = await run("template", () => client.saveReportTemplate({ departments: body }), {
          handled: (e) => {
            const fields = e instanceof ApiError && e.status === 422 ? e.extra.errors : null
            if (Array.isArray(fields) && fields[0] && typeof (fields[0] as { message?: unknown }).message === "string") {
              toast.error((fields[0] as { message: string }).message)
              return true
            }
            return false
          },
        })
        if (r.ok) {
          known.current = r.value.departments
          if (!again.current) {
            latest.current = r.value.departments
            setDepts(r.value.departments)
            toast.success("Template saved", { description: note.current })
          }
        } else {
          // refused: back to what the API holds
          latest.current = known.current
          again.current = false
          setDepts(known.current)
        }
      } while (again.current)
    } finally {
      saving.current = false
    }
  }

  const patch = (sectionId: string, fn: (s: TemplateData["departments"][number]["sections"][number]) => TemplateData["departments"][number]["sections"][number], what: string) => {
    const next = latest.current.map((d) => (d.dept === active ? { ...d, sections: d.sections.map((s) => (s.id === sectionId ? fn(s) : s)) } : d))
    latest.current = next
    note.current = what
    setDepts(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), SAVE_MS)
  }

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
                  onCheckedChange={(on) => patch(s.id, (x) => ({ ...x, enabled: on }), `${on ? "Enabled" : "Disabled"}: ${i + 1}. ${s.title} for ${current.dept}`)}
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
                        onCheckedChange={(on) => patch(s.id, (x) => ({ ...x, fields: x.fields.map((y) => (y.id === f.id ? { ...y, required: on } : y)) }), `${f.label}: ${on ? "required" : "optional"} for ${current.dept}`)}
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
