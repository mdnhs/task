"use client"

import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { TimePicker, formatTime } from "@/components/time-picker"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { OrganisationData } from "../types"

const schema = z.object({
  name: z.string().trim().min(2, "Enter the company name").max(80, "Keep the name under 80 characters"),
  deadline: z.string().regex(/^\d{2}:\d{2}$/, "Choose the report deadline"),
})

// Organisation tab: company, timezone, report deadline, weekend rule and session timeout (FR-AUTH-07).
// Name, slug, timezone and deadline are the tenant's own values, passed in by the route.
export function OrganisationForm({
  data,
  name,
  slug,
  timezone,
  tzLabel,
  deadline,
  canWrite,
}: {
  data: OrganisationData
  name: string
  slug: string
  timezone: string
  tzLabel: string
  deadline: string
  canWrite: boolean
}) {
  const [form, setForm] = useState({ name, timezone, deadline, weekendRule: data.weekendRule, sessionTimeout: data.sessionTimeout })
  const [errors, setErrors] = useState<{ name?: string; deadline?: string }>({})
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }

  // Read-only roles see the value as plain text, not a select that opens.
  const pick = (id: string, label: string, key: "timezone" | "sessionTimeout", options: OrganisationData["timezones"]) =>
    canWrite ? (
      <FilterSelect label={label} value={form[key]} options={options} onChange={(v) => set(key, v)} />
    ) : (
      <Input id={id} readOnly value={options.find((o) => o.value === form[key])?.label ?? form[key]} />
    )

  function save(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse(form)
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof typeof errors
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return
    }
    toast.success("Organisation settings saved", { description: `Report deadline ${formatTime(form.deadline)} ${tzLabel}` })
  }

  return (
    <section className="card set-card" aria-labelledby="set-org-h" data-readonly={canWrite ? undefined : ""}>
      <div className="card-head">
        <div>
          <h2 id="set-org-h">Organisation</h2>
          <div className="sub">Company details and the daily report rules</div>
        </div>
      </div>
      <form className="od-form set-form" onSubmit={save} noValidate>
        <div className="od-row2">
          <Field label="Company name" htmlFor="set-name" error={errors.name} required>
            <Input id="set-name" value={form.name} readOnly={!canWrite} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Subdomain" htmlFor="set-slug" hint="Set when the workspace was created">
            <Input id="set-slug" value={`${slug}.${data.domain}`} readOnly />
          </Field>
        </div>
        <div className="od-row2">
          <Field label="Timezone" htmlFor="set-tz" hint="Deadlines and timestamps use this timezone">
            {pick("set-tz", "Timezone", "timezone", data.timezones)}
          </Field>
          <Field label="Report deadline" htmlFor="set-deadline" error={errors.deadline} hint={`Reports are due by this time, ${tzLabel}`}>
            <TimePicker value={form.deadline} onChange={(v) => set("deadline", v)} disabled={!canWrite} label="Report deadline" step={5} />
          </Field>
        </div>
        <fieldset className="set-fieldset" disabled={!canWrite}>
          <legend>Weekend and holiday rule</legend>
          <RadioGroup className="od-choices" aria-label="Weekend and holiday rule" value={form.weekendRule} disabled={!canWrite} onValueChange={(v) => set("weekendRule", v as string)}>
            {data.weekendRules.map((r) => (
              <label key={r.value} className="od-choice" data-checked={form.weekendRule === r.value ? "" : undefined}>
                <RadioGroupItem value={r.value} aria-label={r.label} />
                {r.label}
              </label>
            ))}
          </RadioGroup>
        </fieldset>
        <div className="od-row2">
          <Field label="Session timeout" htmlFor="set-timeout" hint="Signed-in users are logged out after this much inactivity">
            {pick("set-timeout", "Session timeout", "sessionTimeout", data.sessionTimeouts)}
          </Field>
        </div>
        {canWrite && (
          <div className="od-form-foot">
            <ActionButton type="submit" className="btn btn-primary">Save changes</ActionButton>
          </div>
        )}
      </form>
    </section>
  )
}
