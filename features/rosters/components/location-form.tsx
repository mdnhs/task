"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { archiveShiftType, createLocation, createShiftType, readLocation, setLocationSupervisors, setShiftTypeTargets, updateLocation, updateShiftType } from "@/app/actions/rosters"
import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { FilterSeg } from "@/components/filter-bar"
import { FormSection, PeoplePicker } from "@/components/form-section"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { TimePicker } from "@/components/time-picker"
import { Input } from "@/components/ui/input"
import {
  DAYS, createBody, draftOf, formOf, oddHours, patchBody, sameSet, saveIds, supervisorChoice, targetsBody, typeAction, typeCreateBody, typePatchBody, validateLocation, validateType,
  type LocationErrors, type LocationForm, type TypeDraft,
} from "../admin"
import type { RosterError } from "../errors"
import type { RosterLocation, RosterMember, ShiftType } from "../types"
import { CutHint } from "./cut-hint"

/** What the form needs: the location (null = new), its shift types (archived ones too) and the people this caller may pick (the API's cut list). */
export type LocationFormProps = { location: RosterLocation | null; shiftTypes: ShiftType[]; people: RosterMember[]; truncated: boolean }

const short = (e: RosterError) => e.toast?.text ?? "Not saved."

// Add or edit one location on the API (B8 Task 22; FR-RS-01..04, 30, 34). The details save with the location's `version` and only what changed; someone saving first is the O1 banner
// ("Changed by someone else": Keep mine continues on their version with these edits, Reload theirs drops them). Each shift type is its own small form (its own `version`); a saved type is
// archived, never deleted (rostered shifts keep reading it). Supervisors are picked from the people the API lets this caller see; anyone else already granted is a count, never a name.
export function LocationFormPage({ location, shiftTypes, people, truncated }: LocationFormProps) {
  return (
    <>
      <Link href="/rosters/locations" className="td-back">← Locations</Link>
      <PageHead title={location ? location.name : "New location"} subtitle={location ? "Details, zone, supervisors and shift types." : "Add a site. Shift types come after."} />
      <div className="card nt-card">
        <LocationDetails key={location?.id ?? "new"} location={location} people={people} truncated={truncated} />
      </div>
      {location && <ShiftTypes key={`${location.id}`} locationId={location.id} types={shiftTypes} archivedSite={location.archived} />}
    </>
  )
}

type Theirs = { state: "none" } | { state: "loaded"; location: RosterLocation } | { state: "unavailable" }

function LocationDetails({ location, people, truncated }: { location: RosterLocation | null; people: RosterMember[]; truncated: boolean }) {
  const router = useRouter()
  const [base, setBase] = useState<RosterLocation | null>(location)
  const [version, setVersion] = useState(location?.version ?? 0)
  const [form, setForm] = useState<LocationForm>(() => formOf(location ?? undefined))
  const choice = supervisorChoice(people, base?.supervisorIds ?? [])
  const [picked, setPicked] = useState<string[]>(() => (base?.supervisorIds ?? []).filter((id) => !choice.hidden.includes(id)))
  const [errors, setErrors] = useState<LocationErrors>({})
  const [failed, setFailed] = useState("")
  const [theirs, setTheirs] = useState<Theirs>({ state: "none" })
  const busy = useRef(false)

  const set = <K extends keyof LocationForm>(k: K, v: LocationForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setFailed("")
    if (k in errors) setErrors((e) => ({ ...e, [k]: undefined }))
  }
  const odd = oddHours(form)

  async function loadTheirs(id: string) {
    const r = await readLocation(id)
    setTheirs(r.ok ? { state: "loaded", location: r.value } : { state: "unavailable" })
  }
  function keepMine() {
    if (theirs.state !== "loaded") return
    setBase(theirs.location) // the next save compares with their copy and sends their version: my edits go on top
    setVersion(theirs.location.version)
    setTheirs({ state: "none" })
  }
  function reloadTheirs() {
    if (theirs.state !== "loaded") return
    const l = theirs.location
    setBase(l)
    setVersion(l.version)
    setForm(formOf(l))
    setPicked(l.supervisorIds.filter((id) => people.some((p) => p.id === id)))
    setTheirs({ state: "none" })
  }

  /** One save: the details (if changed), then the supervisor set (if changed). False keeps the button idle (nothing saved or a refusal shown). */
  async function save(): Promise<boolean> {
    if (busy.current || theirs.state !== "none") return false
    const errs = validateLocation(form)
    setErrors(errs)
    if (Object.keys(errs).length) return false
    busy.current = true
    try {
      if (!base) {
        const r = await createLocation(createBody(form))
        if (!r.ok) return fail(r.error)
        if (picked.length) {
          const s = await setLocationSupervisors(r.value.id, picked)
          if (!s.ok) toast.error(short(s.error))
        }
        toast.success(`${r.value.name} added`)
        router.push(`/rosters/locations/${r.value.id}`)
        return true
      }
      const body = patchBody(form, base, version)
      const ids = saveIds(picked, choice.hidden)
      const supsChanged = !sameSet(ids, base.supervisorIds)
      if (!body && !supsChanged) {
        toast("Nothing to save")
        return false
      }
      let next = base
      if (body) {
        const r = await updateLocation(base.id, body)
        if (!r.ok) {
          if (r.error.state === "conflict") {
            await loadTheirs(base.id)
            return false
          }
          return fail(r.error)
        }
        next = r.value
      }
      if (supsChanged) {
        const s = await setLocationSupervisors(base.id, ids)
        if (!s.ok) return fail(s.error)
        next = { ...next, supervisorIds: s.value }
      }
      setBase(next)
      setVersion(next.version)
      toast.success(`${next.name} saved`)
      router.refresh()
      return true
    } finally {
      busy.current = false
    }
  }
  function fail(e: RosterError): false {
    setFailed(short(e))
    return false
  }

  return (
    <form className="od-form nt-form" onSubmit={(e) => e.preventDefault()} noValidate>
      {theirs.state !== "none" && (
        <div className="td-state warn sr-banner" role="alert">
          <strong>Changed by someone else</strong>
          <span>{theirs.state === "unavailable" ? "Your edits are kept. Their version could not be loaded." : "Your edits are kept."}</span>
          <div className="sr-banner-actions">
            {theirs.state === "loaded" ? (
              <>
                <button type="button" className="btn btn-primary" onClick={keepMine}>Keep mine</button>
                <button type="button" className="btn btn-outline" onClick={reloadTheirs}>Reload theirs</button>
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => base && void loadTheirs(base.id)}>Try again</button>
            )}
          </div>
        </div>
      )}
      <div className="od-form-cols">
        <div className="od-form-col">
          <FormSection icon="pin" title="Details">
            <Field label="Name" htmlFor="lf-name" error={errors.name} required>
              <Input id="lf-name" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Address" htmlFor="lf-address" error={errors.address}>
              <Input id="lf-address" value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label="Contact" htmlFor="lf-contact">
              <Input id="lf-contact" value={form.contact} onChange={(e) => set("contact", e.target.value)} />
            </Field>
          </FormSection>
          <FormSection icon="clock" title="Opening hours" note="Optional">
            <div className="rl-days rl-hours" role="group" aria-label="Opening hours">
              {DAYS.map((d) => (
                <label key={d.key} className="rl-day" data-odd={odd.includes(d.key) ? "" : undefined}>
                  <span>{d.label}</span>
                  <Input aria-label={`${d.label} hours`} placeholder="Closed" value={form.hours[d.key]} onChange={(e) => set("hours", { ...form.hours, [d.key]: e.target.value })} />
                </label>
              ))}
            </div>
            <p className="rl-note">e.g. 08:00-22:00</p>
          </FormSection>
          <FormSection icon="radar" title="Clock-in zone">
            <div className="od-row3">
              <Field label="Latitude" htmlFor="lf-lat" error={errors.lat}>
                <Input id="lf-lat" inputMode="decimal" placeholder="53.3343" value={form.lat} onChange={(e) => set("lat", e.target.value)} />
              </Field>
              <Field label="Longitude" htmlFor="lf-lng" error={errors.lng}>
                <Input id="lf-lng" inputMode="decimal" placeholder="-6.2631" value={form.lng} onChange={(e) => set("lng", e.target.value)} />
              </Field>
              <Field label="Radius (m)" htmlFor="lf-radius" error={errors.radius}>
                <Input id="lf-radius" inputMode="numeric" value={form.radius} onChange={(e) => set("radius", e.target.value)} />
              </Field>
            </div>
            <Field label="Time zone" htmlFor="lf-tz" error={errors.timeZone}>
              <Input id="lf-tz" placeholder="Organisation's zone" value={form.timeZone} onChange={(e) => set("timeZone", e.target.value)} />
            </Field>
          </FormSection>
        </div>
        <div className="od-form-col">
          <FormSection icon="user-cog" title="Supervisors" note={choice.hidden.length ? `+${choice.hidden.length} not shown` : undefined}>
            <Field label="Location supervisors" htmlFor="lf-sups">
              <PeoplePicker people={choice.people} value={picked} onChange={(v) => { setPicked(v); setFailed("") }} label="Supervisors" />
            </Field>
            <CutHint cut={truncated} />
          </FormSection>
          <FormSection icon="repeat" title="Swap approval">
            <div className="od-field">
              <FilterSeg<"office" | "supervisor">
                label="Swap approval"
                value={form.delegated ? "supervisor" : "office"}
                options={[{ value: "office", label: "Office approves" }, { value: "supervisor", label: "Supervisor approves" }]}
                onChange={(v) => set("delegated", v === "supervisor")}
              />
            </div>
          </FormSection>
        </div>
      </div>
      {failed && <p className="rl-err" role="alert">{failed}</p>}
      <div className="od-form-foot rl-save-foot">
        <Link href="/rosters/locations" className="btn btn-outline">Cancel</Link>
        <ActionButton className="btn btn-primary" disabled={theirs.state !== "none"} onAction={save}>
          {base ? "Save location" : "Add location"}
        </ActionButton>
      </div>
    </form>
  )
}

function ShiftTypes({ locationId, types, archivedSite }: { locationId: string; types: ShiftType[]; archivedSite: boolean }) {
  const [drafts, setDrafts] = useState<number[]>([])
  const live = types.filter((t) => !t.archived)
  const archived = types.filter((t) => t.archived)
  const skills = [...new Set(types.flatMap((t) => t.requires))].sort()
  return (
    <div className="card nt-card rl-types">
      <div className="od-form nt-form">
        <FormSection
          icon="calendar-clock"
          title="Shift types"
          action={!archivedSite && <button type="button" className="fs-act" onClick={() => setDrafts((d) => [...d, (d.at(-1) ?? 0) + 1])}><Icon name="plus" size={24} />Add</button>}
        >
          {live.length === 0 && drafts.length === 0 && <p className="rl-empty">No shift types yet.</p>}
          <div className="rl-type-grid">
            {live.map((t) => <TypeCard key={`${t.id}:${t.version}`} locationId={locationId} type={t} skills={skills} readOnly={archivedSite} />)}
            {drafts.map((n) => <TypeCard key={`new-${n}`} locationId={locationId} skills={skills} onRemove={() => setDrafts((d) => d.filter((x) => x !== n))} />)}
          </div>
          {archived.length > 0 && (
            <details className="ev-earlier">
              <summary>Archived ({archived.length})</summary>
              <ul className="mr-chips">
                {archived.map((t) => (
                  <li key={t.id} className="mr-chip">
                    <span><b>{t.name}</b> <span className="rl-note num">{t.start}–{t.end}</span></span>
                    <StatusPill status={{ tone: "info", label: "Archived" }} tick={false} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </FormSection>
      </div>
    </div>
  )
}

/** One shift type: name, role, times, break, required skills and the staffing target per weekday. Saved alone with its own version; targets are their own whole set. */
function TypeCard({ locationId, type, skills, readOnly, onRemove }: { locationId: string; type?: ShiftType; skills: string[]; readOnly?: boolean; onRemove?: () => void }) {
  const router = useRouter()
  const [d, setD] = useState<TypeDraft>(() => draftOf(type))
  const [skill, setSkill] = useState("")
  const [extra, setExtra] = useState<string[]>([])
  const [error, setError] = useState("")
  const busy = useRef(false)
  const action = typeAction(type)
  const id = type?.id ?? `new-${locationId}`
  const patch = (p: Partial<TypeDraft>) => { setD((x) => ({ ...x, ...p })); setError("") }
  const options = [...new Set([...skills, ...d.requires, ...extra])].sort()
  const dirty = !type || typePatchBody(d, type) !== null || targetsBody(d, type) !== null
  const label = type?.name || "New shift type"

  async function save(): Promise<boolean> {
    if (busy.current) return false
    const bad = validateType(d)
    setError(bad ?? "")
    if (bad) return false
    busy.current = true
    try {
      let saved = type
      if (!type) {
        const r = await createShiftType(locationId, typeCreateBody(d))
        if (!r.ok) return refused(r.error)
        saved = r.value
      } else {
        const body = typePatchBody(d, type)
        if (body) {
          const r = await updateShiftType(type.id, body)
          if (!r.ok) return refused(r.error)
          saved = r.value
        }
      }
      const targets = targetsBody(d, type)
      if (saved && targets) {
        const r = await setShiftTypeTargets(saved.id, targets)
        if (!r.ok) return refused(r.error)
      }
      toast.success(`${d.name.trim()} saved`)
      onRemove?.()
      router.refresh()
      return true
    } finally {
      busy.current = false
    }
  }
  function refused(e: RosterError): false {
    if (e.state === "conflict") {
      toast.error("Changed by someone else.")
      router.refresh()
      return false
    }
    setError(short(e))
    return false
  }
  async function archive(): Promise<boolean> {
    if (!type || busy.current) return false
    busy.current = true
    try {
      const r = await archiveShiftType(type.id)
      if (!r.ok) return refused(r.error)
      toast.success(`${type.name} archived`)
      router.refresh()
      return true
    } finally {
      busy.current = false
    }
  }
  const addSkill = () => {
    const s = skill.trim()
    if (!s) return
    setExtra((x) => (x.includes(s) ? x : [...x, s]))
    if (!d.requires.includes(s)) patch({ requires: [...d.requires, s] })
    setSkill("")
  }

  return (
    <fieldset className="rl-tpl" aria-label={label} disabled={readOnly}>
      <div className="od-row2">
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} placeholder="Night" value={d.name} onChange={(e) => patch({ name: e.target.value })} />
        </Field>
        <Field label="Role" htmlFor={`${id}-role`}>
          <Input id={`${id}-role`} placeholder="Security officer" value={d.role} onChange={(e) => patch({ role: e.target.value })} />
        </Field>
      </div>
      <div className="od-row3">
        <Field label="Start" htmlFor={`${id}-start`}>
          <TimePicker label="Start" value={d.start} onChange={(v) => patch({ start: v })} />
        </Field>
        <Field label="End" htmlFor={`${id}-end`}>
          <TimePicker label="End" value={d.end} onChange={(v) => patch({ end: v })} />
        </Field>
        <Field label="Break (min)" htmlFor={`${id}-break`}>
          <Input id={`${id}-break`} inputMode="numeric" value={d.breakMin} onChange={(e) => patch({ breakMin: e.target.value.replace(/\D/g, "") })} />
        </Field>
      </div>
      <div className="rl-targets" role="group" aria-label={`Targets for ${label}`}>
        <span className="fs-label">Staff per day</span>
        <div className="rl-days">
          {DAYS.map((x) => (
            <label key={x.day} className="rl-day">
              <span>{x.label}</span>
              <Input inputMode="numeric" aria-label={`${label} ${x.label}`} placeholder="0" value={d.targets[x.day] ?? ""} onChange={(e) => patch({ targets: { ...d.targets, [x.day]: e.target.value.replace(/\D/g, "") } })} />
            </label>
          ))}
        </div>
      </div>
      <div className="od-field" role="group" aria-label={`Skills for ${label}`}>
        <span className="fs-label">Required skills</span>
        <div className="er-types">
          {options.map((s) => (
            <button key={s} type="button" className="rp-day" aria-pressed={d.requires.includes(s)} onClick={() => patch({ requires: d.requires.includes(s) ? d.requires.filter((x) => x !== s) : [...d.requires, s] })}>{s}</button>
          ))}
          <span className="rl-skill-add">
            <Input aria-label={`New skill for ${label}`} placeholder="Add skill" value={skill} onChange={(e) => setSkill(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill() } }} />
            <button type="button" className="fs-act" aria-label={`Add skill to ${label}`} onClick={addSkill}><Icon name="plus" size={24} /></button>
          </span>
        </div>
      </div>
      {error && <p className="rl-err" role="alert">{error}</p>}
      {!readOnly && (
        <div className="rl-tpl-foot">
          {action === "archive" && (
            <ActionButton className="fs-act bad" aria-label={`Archive ${label}`} onAction={archive}><Icon name="archive" size={24} />Archive</ActionButton>
          )}
          {action === "remove" && (
            <button type="button" className="fs-act bad" aria-label={`Remove ${label}`} onClick={onRemove}><Icon name="close" size={24} />Remove</button>
          )}
          <ActionButton className="btn btn-primary mr-btn" disabled={!dirty} onAction={save}>{type ? "Save" : "Add"}</ActionButton>
        </div>
      )}
    </fieldset>
  )
}
