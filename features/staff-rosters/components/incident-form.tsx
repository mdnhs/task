"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ClipboardList, MapPin, Siren } from "lucide-react"
import { toast } from "sonner"

import { Field } from "@/components/field"
import { FilterSeg, FilterSelect } from "@/components/filter-bar"
import { FoldToggle, FormFold, FormSection } from "@/components/form-section"
import { PageHead } from "@/components/page-head"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { nowInTz } from "@/lib/dates"
import { createIncident, incidentSchema, rostersHref } from "../logic"
import type { IncidentInput } from "../logic"
import { incidentsStore } from "../store"
import { INCIDENT_TYPE } from "../types"
import type { Incident, IncidentType, StaffMember } from "../types"
import { fieldErrors } from "./dialog-util"

type Form = IncidentInput
type Errors = Partial<Record<keyof Form, string>>

const TYPES = (Object.keys(INCIDENT_TYPE) as IncidentType[]).map((t) => ({ value: t, label: INCIDENT_TYPE[t] }))
const BACK = rostersHref("attendance")

// /staff-rosters/incidents/new: record a call-out, no-show, cover request or staff issue. Seeds the incidents store
// exactly like /staff-rosters (same seed + scopeKey), so the new row is on the Attendance tab after Save.
export function IncidentForm({
  incidents,
  staff,
  today,
  tz,
  actor,
  scopeKey,
}: {
  incidents: Incident[]
  staff: StaffMember[]
  today: string
  tz: string
  actor: string
  scopeKey: string
}) {
  const router = useRouter()
  const [, setIncidents] = incidentsStore.useStore(incidents, scopeKey)
  const [form, setForm] = useState<Form>({ type: "callout", staff: "", site: "", client: "", shift: "", action: "", contact: "", notes: "" })
  const [errors, setErrors] = useState<Errors>({})
  const [showMore, setShowMore] = useState(false)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = incidentSchema.safeParse(form)
    if (!parsed.success) return setErrors(fieldErrors<keyof Form>(parsed.error))
    let id = ""
    const h = { at: nowInTz(today, tz), by: actor, action: "Incident logged" }
    setIncidents((prev) => {
      const created = createIncident(prev, parsed.data, staff, h)
      id = created.id
      return [created, ...prev]
    })
    toast.success(`${id} logged`)
    router.push(BACK)
  }

  // Contact and notes start folded; an error inside opens the fold so the message is seen.
  const moreOpen = showMore || !!errors.notes || !!errors.contact

  return (
    <>
      <Link href={BACK} className="sr-back">← Staff &amp; Rosters</Link>
      <PageHead title="Log incident" subtitle="Call-out, no-show, cover request or staff issue." />
      <div className="card sr-page-card">
        <form className="od-form sr-form" onSubmit={submit} noValidate>
          <div className="od-form-cols">
            <div className="od-form-col">
              <FormSection icon={Siren} title="Incident">
                <div className="od-field sr-seg">
                  <span className="fs-label">Type</span>
                  <FilterSeg label="Type" value={form.type} options={TYPES} onChange={(v) => set("type", v)} />
                </div>
                <div className="od-row2">
                  <Field label="Staff member" htmlFor="sr-staff" error={errors.staff} required>
                    <FilterSelect
                      label="Staff member"
                      value={form.staff}
                      options={[{ value: "", label: "Choose…" }, ...staff.map((s) => ({ value: s.name, label: s.name }))]}
                      onChange={(v) => set("staff", v)}
                    />
                  </Field>
                  <Field label="Shift or subject" htmlFor="sr-shift" error={errors.shift} required>
                    <Input id="sr-shift" placeholder="e.g. 22:00–06:00" value={form.shift} onChange={(e) => set("shift", e.target.value)} />
                  </Field>
                </div>
              </FormSection>
              <FormSection icon={MapPin} title="Where">
                <div className="od-row2">
                  <Field label="Site" htmlFor="sr-site" error={errors.site} required>
                    <Input id="sr-site" value={form.site} onChange={(e) => set("site", e.target.value)} />
                  </Field>
                  <Field label="Client" htmlFor="sr-client" error={errors.client} required>
                    <Input id="sr-client" value={form.client} onChange={(e) => set("client", e.target.value)} />
                  </Field>
                </div>
              </FormSection>
            </div>
            <div className="od-form-col">
              <FormSection
                icon={ClipboardList}
                title="Follow-up"
                action={<FoldToggle open={moreOpen} onToggle={() => setShowMore((v) => !v)} controls="sr-more" label="Contact, notes" />}
              >
                <Field label="Next action" htmlFor="sr-action" error={errors.action} required>
                  <Input id="sr-action" placeholder="e.g. Find cover by 18:00" value={form.action} onChange={(e) => set("action", e.target.value)} />
                </Field>
                <FormFold id="sr-more" open={moreOpen}>
                  <Field label="Contact" htmlFor="sr-contact" error={errors.contact} hint="Hidden from read-only roles">
                    <Input id="sr-contact" placeholder="e.g. phone number" value={form.contact} onChange={(e) => set("contact", e.target.value)} />
                  </Field>
                  <Field label="Notes" htmlFor="sr-notes" error={errors.notes}>
                    <Textarea id="sr-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} />
                  </Field>
                </FormFold>
              </FormSection>
            </div>
          </div>
          <div className="od-form-foot">
            <Link href={BACK} className="btn btn-outline">Cancel</Link>
            <button type="submit" className="btn btn-primary">Log incident</button>
          </div>
        </form>
      </div>
    </>
  )
}
