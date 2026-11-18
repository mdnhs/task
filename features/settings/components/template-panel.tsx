"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { FilterSeg } from "@/components/filter-bar"
import { useDept } from "@/hooks/use-dept"
import { Switch } from "@/components/ui/switch"
import { apiBrowser } from "@/lib/api/browser"
import { ApiError, userMessage } from "@/lib/api/problem"
import type { TemplateData } from "../types"
import { makeSettingsClient } from "../client"
import { makeTemplateSession, type TemplateSession, type TemplateSnapshot } from "../template-session"

// Shift report template (FR-M1-25, was FR-ORG-04) on the API (B6 T6.7): per team (a department is matched to a team by NAME), which sections are enabled and which fields are required.
// `GET/PUT /v1/shift-reports/template`: every change updates the screen at once and ONE save (500 ms after the last change) replaces the whole template under If-Match (the ETag it was read with, B7 S6);
// what the API answers is what stays (the department names follow a team rename). 412 = someone saved first: the banner "Changed by someone else" with Reload, edits paused (template-session.ts).
// Any other refusal reverts to what the API holds and says why: 422 invalid_template with its field messages, 422 template_too_large (64 KB), 409 template_dept_exists. It applies to NEW submissions only.
// The tabs pick a department; the global department filter preselects it.
export function TemplatePanel({ data, etag, canWrite }: { data: TemplateData; etag: string | null; canWrite: boolean }) {
  const session = useRef<TemplateSession | null>(null)
  const [snap, setSnap] = useState<TemplateSnapshot>({ depts: data.departments, conflict: "none", reloading: false })
  if (session.current === null) {
    const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
    session.current = makeTemplateSession({
      client, data, etag,
      onChange: setSnap,
      onSaved: (note) => toast.success("Template saved", { description: note }),
      onRefused: (e) => {
        const fields = e instanceof ApiError && e.status === 422 ? e.extra.errors : null
        if (Array.isArray(fields) && fields[0] && typeof (fields[0] as { message?: unknown }).message === "string") toast.error((fields[0] as { message: string }).message)
        else {
          const m = userMessage(e)
          toast.error(m.text, m.ref ? { description: `Ref ${m.ref}` } : undefined)
        }
      },
    })
  }
  const depts = snap.depts
  const stale = snap.conflict !== "none"
  const global = useDept()
  const [picked, setPicked] = useState(data.departments[0]?.dept ?? "")
  const active = global !== "all" && depts.some((d) => d.dept === global) ? global : picked
  const current = depts.find((d) => d.dept === active)
  useEffect(() => () => session.current?.dispose(), [])

  const patch = (sectionId: string, fn: (s: TemplateData["departments"][number]["sections"][number]) => TemplateData["departments"][number]["sections"][number], what: string) =>
    session.current!.edit((all) => all.map((d) => (d.dept === active ? { ...d, sections: d.sections.map((s) => (s.id === sectionId ? fn(s) : s)) } : d)), what)

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
      {stale && (
        <div className="td-state warn sr-banner" role="alert">
          <strong>Changed by someone else</strong>
          <span>{snap.conflict === "unavailable" ? "Couldn't load their version. Try again." : "Reload to see their version."}</span>
          <div className="sr-banner-actions">
            <button type="button" className="btn btn-primary" disabled={snap.reloading} onClick={() => void session.current!.reload()}>Reload</button>
          </div>
        </div>
      )}
      <ul className="set-list">
        {current?.sections.map((s, i) => (
          <li key={s.id} className="set-sec" data-off={s.enabled ? undefined : ""}>
            <div className="set-sec-head">
              <label className="set-switch-row">
                <Switch
                  checked={s.enabled}
                  disabled={!canWrite || stale}
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
                        disabled={!canWrite || stale}
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
