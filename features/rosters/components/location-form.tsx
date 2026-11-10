"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BadgeCheck, CalendarClock, Plus, Repeat, Target, Trash2, UserCog, Radar, MapPin } from "lucide-react"
import { toast } from "sonner"

import { Field } from "@/components/field"
import { FilterSeg } from "@/components/filter-bar"
import { FormSection, PeoplePicker } from "@/components/form-section"
import { PageHead } from "@/components/page-head"
import { TimePicker } from "@/components/time-picker"
import { Input } from "@/components/ui/input"
import type { Weekday } from "@/lib/shifts"
import { assignableMembers, canDeleteTemplate, setSupervisors, supervisorHistory, validateLocation, type LocationErrors, type LocationForm } from "../admin"
import { grantsStore, historyStore, locationsStore, shiftsStore, targetsStore, templatesStore } from "../store"
import type { Location, LocationAdminData, ShiftTemplate, StaffingTarget } from "../types"

const DAYS: { day: Weekday; label: string }[] = [{ day: 1, label: "Mon" }, { day: 2, label: "Tue" }, { day: 3, label: "Wed" }, { day: 4, label: "Thu" }, { day: 5, label: "Fri" }, { day: 6, label: "Sat" }, { day: 0, label: "Sun" }]

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

// Add or edit one location (FR-RS-01..04, 30). A long form, so a page (ui-rules 31/32): details, clock-in zone, shift templates,
// staffing targets, required skills, supervisors, swap approval. Edits live in the stores until reload (mock).
export function LocationFormPage({ data, id, scopeKey, me, today }: { data: LocationAdminData; id: string; scopeKey: string; me: string; today: string }) {
  const [locations] = locationsStore.useStore(data.locations, scopeKey)
  const existing = id === "new" ? undefined : locations.find((l) => l.id === id)
  return (
    <>
      <Link href="/rosters/locations" className="td-back">← Locations</Link>
      <PageHead title={existing ? existing.name : "New location"} subtitle={existing ? "Site details, shift templates, targets and who manages it." : "Add a site, its shifts and who manages it."} />
      <div className="card nt-card">
        <LocationFormBody key={existing?.id ?? "new"} data={data} location={existing} scopeKey={scopeKey} me={me} today={today} />
      </div>
    </>
  )
}

function LocationFormBody({ data, location, scopeKey, me, today }: { data: LocationAdminData; location?: Location; scopeKey: string; me: string; today: string }) {
  const router = useRouter()
  const [, setLocations] = locationsStore.useStore(data.locations, scopeKey)
  const [allTemplates, setTemplates] = templatesStore.useStore(data.templates, scopeKey)
  const [allTargets, setTargets] = targetsStore.useStore(data.targets, scopeKey)
  const [grants, setGrants] = grantsStore.useStore(data.grants, scopeKey)
  const [history, setHistory] = historyStore.useStore(data.history, scopeKey)
  // The shifts as edited on the Rosters page (same scope), so a template used by a shift added there can't be deleted either.
  const [shifts] = shiftsStore.useStore(data.shifts, scopeKey)
  const locId = location?.id ?? ""
  const start = {
    form: {
      name: location?.name ?? "", address: location?.address ?? "", lat: location ? String(location.pin.lat) : "", lng: location ? String(location.pin.lng) : "",
      radius: location ? String(location.zoneRadiusM) : "150", openingHours: location?.openingHours ?? "", contact: location?.contact ?? "",
    } satisfies LocationForm,
    tpls: allTemplates.filter((t) => t.locationId === locId),
    targets: Object.fromEntries(allTargets.filter((t) => t.locationId === locId).map((t) => [`${t.templateId}:${t.weekday}`, String(t.count)])),
    sups: grants.filter((g) => g.locationId === locId).map((g) => g.personId),
  }
  const [form, setForm] = useState<LocationForm>(start.form)
  const [tpls, setTpls] = useState<ShiftTemplate[]>(start.tpls)
  const [targets, setTargetCounts] = useState<Record<string, string>>(start.targets)
  const [sups, setSups] = useState<string[]>(start.sups)
  const [delegated, setDelegated] = useState(location?.swapApprovalDelegated ?? false)
  const [custom, setCustom] = useState<string[]>([])
  const [skillDraft, setSkillDraft] = useState("")
  const [errors, setErrors] = useState<LocationErrors>({})
  const [tplError, setTplError] = useState("")
  const [done, setDone] = useState(false)

  const set = <K extends keyof LocationForm>(k: K, v: string) => { setForm((f) => ({ ...f, [k]: v })); if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined })) }
  const patchTpl = (id: string, patch: Partial<ShiftTemplate>) => { setTpls((p) => p.map((t) => (t.id === id ? { ...t, ...patch } : t))); setTplError("") }
  const addTpl = () => setTpls((p) => [...p, { id: `tpl-${slug(form.name) || "new"}-${Date.now().toString(36)}${p.length}`, locationId: locId, name: "", start: "09:00", end: "17:00", unpaidBreakMin: 30, role: "", requires: [] }])
  const savedIds = new Set(start.tpls.map((t) => t.id))
  const skillOptions = [...new Set([...data.skills, ...tpls.flatMap((t) => t.requires), ...custom])].sort()
  const people = assignableMembers(data.members, today.slice(0, 10))
  const supPeople = [...people, ...data.members.filter((m) => sups.includes(m.id) && !people.some((p) => p.id === m.id))]

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (done) return
    const errs = validateLocation(form)
    setErrors(errs)
    const badTpl = tpls.find((t) => !t.name.trim() || !t.role.trim() || t.start === t.end || !(t.unpaidBreakMin >= 0))
    setTplError(badTpl ? "Each template needs a name, role, different start and end, and a break of 0 or more" : "")
    if (Object.keys(errs).length || badTpl) return
    const id = location?.id ?? `loc-${slug(form.name)}-${Date.now().toString(36)}`
    const next: Location = {
      id, name: form.name.trim(), address: form.address.trim(), pin: { lat: Number(form.lat), lng: Number(form.lng) }, zoneRadiusM: Number(form.radius),
      openingHours: form.openingHours.trim(), contact: form.contact.trim(), swapApprovalDelegated: delegated,
    }
    const mine = tpls.map((t) => ({ ...t, locationId: id, name: t.name.trim(), role: t.role.trim() }))
    const counts: StaffingTarget[] = mine.flatMap((t) => DAYS.flatMap(({ day }) => {
      const count = Number(targets[`${t.id}:${day}`] ?? 0)
      return count > 0 ? [{ locationId: id, templateId: t.id, weekday: day, count }] : []
    }))
    setLocations((p) => (location ? p.map((l) => (l.id === id ? next : l)) : [...p, next]))
    setTemplates((p) => [...p.filter((t) => t.locationId !== id), ...mine])
    setTargets((p) => [...p.filter((t) => t.locationId !== id), ...counts])
    const change = setSupervisors(grants, id, sups)
    setGrants(() => change.grants)
    const line = supervisorHistory(id, start.sups, sups, me, `${today.slice(0, 10)}T${today.slice(11, 16)}:00`, history)
    if (line) setHistory((p) => [...p, line])
    toast.success(location ? `${next.name} saved` : `${next.name} added`)
    setDone(true)
    router.push("/rosters/locations")
  }

  const toggleSkill = (t: ShiftTemplate, s: string) => patchTpl(t.id, { requires: t.requires.includes(s) ? t.requires.filter((x) => x !== s) : [...t.requires, s] })
  const addSkill = () => {
    const s = skillDraft.trim()
    if (!s) return
    setCustom((c) => (c.includes(s) ? c : [...c, s]))
    setSkillDraft("")
  }

  return (
    <form className="od-form nt-form" onSubmit={submit} noValidate>
      <div className="od-form-cols">
        <div className="od-form-col">
          <FormSection icon={MapPin} title="Details">
            <Field label="Name" htmlFor="lf-name" error={errors.name} required>
              <Input id="lf-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Address" htmlFor="lf-address" error={errors.address} required>
              <Input id="lf-address" value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <div className="od-row2">
              <Field label="Opening hours" htmlFor="lf-hours">
                <Input id="lf-hours" placeholder="e.g. Mon-Sun 12:00-03:30" value={form.openingHours} onChange={(e) => set("openingHours", e.target.value)} />
              </Field>
              <Field label="Contact" htmlFor="lf-contact">
                <Input id="lf-contact" value={form.contact} onChange={(e) => set("contact", e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <FormSection icon={Radar} title="Clock-in zone">
            <div className="od-row3">
              <Field label="Latitude" htmlFor="lf-lat" error={errors.lat} required>
                <Input id="lf-lat" inputMode="decimal" placeholder="e.g. 53.3343" value={form.lat} onChange={(e) => set("lat", e.target.value)} />
              </Field>
              <Field label="Longitude" htmlFor="lf-lng" error={errors.lng} required>
                <Input id="lf-lng" inputMode="decimal" placeholder="e.g. -6.2631" value={form.lng} onChange={(e) => set("lng", e.target.value)} />
              </Field>
              <Field label="Radius (m)" htmlFor="lf-radius" error={errors.radius} required>
                <Input id="lf-radius" inputMode="numeric" value={form.radius} onChange={(e) => set("radius", e.target.value)} />
              </Field>
            </div>
          </FormSection>
          <FormSection icon={CalendarClock} title="Shift templates" action={<button type="button" className="fs-act" onClick={addTpl}><Plus aria-hidden="true" />Add template</button>}>
            {tpls.length === 0 && <p className="rl-empty">No templates yet.</p>}
            {tpls.map((t, i) => {
              const inUse = savedIds.has(t.id) && !canDeleteTemplate(t.id, shifts)
              return (
                <div key={t.id} className="rl-tpl" role="group" aria-label={`Template ${i + 1}`}>
                  <div className="od-row2">
                    <Field label="Name" htmlFor={`lf-t${i}-name`}>
                      <Input id={`lf-t${i}-name`} placeholder="e.g. Night" value={t.name} onChange={(e) => patchTpl(t.id, { name: e.target.value })} />
                    </Field>
                    <Field label="Role" htmlFor={`lf-t${i}-role`}>
                      <Input id={`lf-t${i}-role`} placeholder="e.g. Security Officer" value={t.role} onChange={(e) => patchTpl(t.id, { role: e.target.value })} />
                    </Field>
                  </div>
                  <div className="od-row3">
                    <Field label="Start" htmlFor={`lf-t${i}-start`}>
                      <TimePicker label="Start" value={t.start} onChange={(v) => patchTpl(t.id, { start: v })} />
                    </Field>
                    <Field label="End" htmlFor={`lf-t${i}-end`}>
                      <TimePicker label="End" value={t.end} onChange={(v) => patchTpl(t.id, { end: v })} />
                    </Field>
                    <Field label="Break (min)" htmlFor={`lf-t${i}-break`}>
                      <Input id={`lf-t${i}-break`} inputMode="numeric" value={String(t.unpaidBreakMin)} onChange={(e) => patchTpl(t.id, { unpaidBreakMin: Number(e.target.value.replace(/\D/g, "")) })} />
                    </Field>
                  </div>
                  <div className="rl-tpl-foot">
                    {inUse ? <span className="rl-note">In use by shifts</span> : <span />}
                    <button type="button" className="fs-act bad" disabled={inUse} title={inUse ? "A template used by shifts can't be deleted" : undefined} onClick={() => setTpls((p) => p.filter((x) => x.id !== t.id))}>
                      <Trash2 aria-hidden="true" />
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
            {tplError && <p className="rl-err" role="alert">{tplError}</p>}
          </FormSection>
        </div>
        <div className="od-form-col">
          <FormSection icon={Target} title="Staffing targets">
            {tpls.length === 0 && <p className="rl-empty">Add a template to set targets.</p>}
            {tpls.map((t, i) => (
              <div key={t.id} className="rl-targets" role="group" aria-label={`Targets for ${t.name || `template ${i + 1}`}`}>
                <span className="fs-label">{t.name || `Template ${i + 1}`}</span>
                <div className="rl-days">
                  {DAYS.map(({ day, label }) => (
                    <label key={day} className="rl-day">
                      <span>{label}</span>
                      <Input inputMode="numeric" aria-label={`${t.name || `Template ${i + 1}`} ${label}`} value={targets[`${t.id}:${day}`] ?? ""} placeholder="0" onChange={(e) => setTargetCounts((c) => ({ ...c, [`${t.id}:${day}`]: e.target.value.replace(/\D/g, "") }))} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </FormSection>
          <FormSection icon={BadgeCheck} title="Required skills" note="Optional">
            {tpls.map((t, i) => (
              <div key={t.id} className="od-field" role="group" aria-label={`Skills for ${t.name || `template ${i + 1}`}`}>
                <span className="fs-label">{t.name || `Template ${i + 1}`}</span>
                <div className="er-types">
                  {skillOptions.length === 0 && <span className="rl-empty">No skills on record.</span>}
                  {skillOptions.map((s) => (
                    <button key={s} type="button" className="rp-day" aria-pressed={t.requires.includes(s)} onClick={() => toggleSkill(t, s)}>{s}</button>
                  ))}
                </div>
              </div>
            ))}
            <div className="tpl-row">
              <Field label="New skill" htmlFor="lf-skill">
                <Input id="lf-skill" placeholder="e.g. Site induction" value={skillDraft} onChange={(e) => setSkillDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill() } }} />
              </Field>
              <button type="button" className="btn btn-outline" onClick={addSkill}>Add</button>
            </div>
          </FormSection>
          <FormSection icon={UserCog} title="Supervisors">
            <Field label="Location supervisors" htmlFor="lf-sups">
              <PeoplePicker people={supPeople} value={sups} onChange={setSups} label="Supervisors" />
            </Field>
          </FormSection>
          <FormSection icon={Repeat} title="Swap approval">
            <div className="od-field">
              <FilterSeg<"office" | "supervisor">
                label="Swap approval"
                value={delegated ? "supervisor" : "office"}
                options={[{ value: "office", label: "Office approves" }, { value: "supervisor", label: "Supervisor approves" }]}
                onChange={(v) => setDelegated(v === "supervisor")}
              />
            </div>
          </FormSection>
        </div>
      </div>
      <div className="od-form-foot">
        <Link href="/rosters/locations" className="btn btn-outline">Cancel</Link>
        <button type="submit" className="btn btn-primary" disabled={done}>
          {location ? "Save location" : "Add location"}
        </button>
      </div>
    </form>
  )
}
