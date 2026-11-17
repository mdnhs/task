"use client"

import { useState } from "react"
import { Building2, CalendarClock, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { FormSection } from "@/components/form-section"
import { TimePicker, formatTime } from "@/components/time-picker"
import { Input } from "@/components/ui/input"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { fieldErrorOf, idleLabel, organisationPatch } from "../adapters"
import { makeSettingsClient } from "../client"
import type { Organisation, OrganisationData } from "../types"

const schema = z.object({
  name: z.string().trim().min(2, "Enter the company name").max(80, "Keep the name under 80 characters"),
  reportDeadline: z.string().regex(/^\d{2}:\d{2}$/, "Choose the report deadline"),
})

// Organisation tab (GET/PATCH /v1/settings/organisation): company name, timezone and the daily report deadline. Only what changed is sent. The weekend rule has no backend (the API has holidays instead). The session timeout is shown read-only. Name, slug, timezone and deadline are the tenant's own values.
export function OrganisationForm({ options, org, tzLabel, sessionIdleHours, canWrite }: { options: OrganisationData; org: Organisation; tzLabel: string; /** Idle sign-out, from /v1/me/tenant. Read-only: the platform sets it. */ sessionIdleHours: number | null; canWrite: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const [form, setForm] = useState({ name: org.name, timezone: org.timezone, reportDeadline: org.reportDeadline })
  const [errors, setErrors] = useState<{ name?: string; timezone?: string; reportDeadline?: string }>({})
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }
  // the tenant's current zone is always a choice, even when it is not in the short list
  const zones = options.timezones.some((o) => o.value === org.timezone) ? options.timezones : [{ value: org.timezone, label: org.timezone }, ...options.timezones]

  async function save() {
    const parsed = schema.safeParse(form)
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as keyof typeof errors
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return false
    }
    const patch = organisationPatch(org, form)
    if (Object.keys(patch).length === 0) {
      toast("Nothing to save")
      return true
    }
    // A refused field shows under that field (handled); any other refusal is the runner's toast (mapped copy plus a Ref).
    const r = await run("organisation", () => client.saveOrganisation(patch), {
      handled: (e) => {
        const f = fieldErrorOf(e)
        if (!f || (f.field !== "name" && f.field !== "timezone" && f.field !== "reportDeadline")) return false
        setErrors({ [f.field]: f.message })
        return true
      },
    })
    if (r.ok) toast.success("Organisation settings saved", { description: `Report deadline ${formatTime(form.reportDeadline)} ${tzLabel}` })
    return r.ok
  }

  return (
    <section className="card set-card" aria-labelledby="set-org-h" data-readonly={canWrite ? undefined : ""}>
      <div className="card-head">
        <div>
          <h2 id="set-org-h">Organisation</h2>
          <div className="sub">Company details and the daily report rules</div>
        </div>
      </div>
      <form className="od-form set-form" onSubmit={(e) => { e.preventDefault(); document.getElementById("org-save")?.click() }} noValidate>
        <div className="od-form-cols">
          <div className="od-form-col">
            <FormSection icon={Building2} title="Company">
              <Field label="Company name" htmlFor="set-name" error={errors.name} required>
                <Input id="set-name" value={form.name} readOnly={!canWrite} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Workspace ID" htmlFor="set-slug">
                <Input id="set-slug" value={org.slug} readOnly />
              </Field>
            </FormSection>
            <FormSection icon={ShieldCheck} title="Security">
              <Field label="Session timeout" htmlFor="set-timeout" hint="Idle time before sign-out. Set by the platform for now.">
                <Input id="set-timeout" readOnly value={sessionIdleHours === null ? "—" : idleLabel(sessionIdleHours)} />
              </Field>
            </FormSection>
          </div>
          <div className="od-form-col">
            <FormSection icon={CalendarClock} title="Daily report">
              <Field label="Timezone" htmlFor="set-tz" error={errors.timezone}>
                {canWrite ? (
                  <FilterSelect label="Timezone" value={form.timezone} options={zones} onChange={(v) => set("timezone", v)} />
                ) : (
                  <Input id="set-tz" readOnly value={zones.find((o) => o.value === form.timezone)?.label ?? form.timezone} />
                )}
              </Field>
              <Field label="Report deadline" htmlFor="set-deadline" error={errors.reportDeadline}>
                <TimePicker value={form.reportDeadline} onChange={(v) => set("reportDeadline", v)} disabled={!canWrite} label="Report deadline" step={5} />
              </Field>
            </FormSection>
          </div>
        </div>
        {canWrite && (
          <div className="od-form-foot">
            <ActionButton id="org-save" type="button" className="btn btn-primary" onAction={save}>Save changes</ActionButton>
          </div>
        )}
      </form>
    </section>
  )
}
