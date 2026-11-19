"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { readQualifications, setQualifications } from "@/app/actions/rosters"
import { ActionButton } from "@/components/action-button"
import { DatePicker } from "@/components/date-picker"
import { FilterSelect } from "@/components/filter-bar"
import { FormSection } from "@/components/form-section"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { Input } from "@/components/ui/input"
import { formatDate } from "@/lib/dates"
import { qualBody, qualDrafts, qualState, sameKey, supervisorChoice, validateQuals, type QualDraft, type QualState } from "../admin"
import type { Qualification, RosterLocation, RosterMember } from "../types"
import { CutHint } from "./cut-hint"

export type LocationsViewProps = { locations: RosterLocation[]; people: RosterMember[]; truncated: boolean; today: string }

// Locations admin on the API (B8 Task 22; FR-RS-01, 30, 34). The locations the caller may see (the API's list, archived ones folded away), each with its zone and supervisors: a supervisor
// this caller cannot see is a count, never a name. Below, the licence editor (FR-RS-04, R8-6): pick a person from the API's list, their licences show the API's expiry state.
export function LocationsView({ locations, people, truncated, today }: LocationsViewProps) {
  const live = locations.filter((l) => !l.archived)
  const archived = locations.filter((l) => l.archived)
  return (
    <>
      <Link href="/rosters" className="td-back">← Rosters</Link>
      <PageHead
        title="Locations"
        subtitle="Sites, zones and who runs them."
        actions={<Link href="/rosters/locations/new" className="btn btn-primary"><Icon name="plus" size={24} />New location</Link>}
      />
      <div className="card rl-list">
        {live.length === 0 && <p className="rl-empty">No locations yet.</p>}
        {live.map((l) => <LocationRow key={l.id} l={l} people={people} />)}
        {archived.length > 0 && (
          <details className="ev-earlier rl-archived">
            <summary>Archived ({archived.length})</summary>
            {archived.map((l) => <LocationRow key={l.id} l={l} people={people} />)}
          </details>
        )}
      </div>
      <LicenceEditor people={people} truncated={truncated} today={today} />
    </>
  )
}

function LocationRow({ l, people }: { l: RosterLocation; people: RosterMember[] }) {
  const { people: visible, hidden } = supervisorChoice(people, l.supervisorIds)
  const names = visible.filter((p) => l.supervisorIds.includes(p.id)).map((p) => p.name)
  const sups = names.length === 0 && hidden.length === 0 ? "No supervisor" : [...names, ...(hidden.length ? [`+${hidden.length}`] : [])].join(", ")
  return (
    <Link href={`/rosters/locations/${l.id}`} className="rl-row">
      <span className="rl-ico" aria-hidden="true"><Icon name="pin" size={24} /></span>
      <span className="rl-main">
        <b>{l.name}</b>
        <span>{l.address || "No address"}</span>
      </span>
      <span className="rl-meta num">{l.zoneRadiusM === null ? "No zone" : `${l.zoneRadiusM} m`} · {l.timeZone ?? "Org zone"}</span>
      <span className="rl-sups"><Icon name="user-cog" size={24} className="rl-sups-i" />{sups}</span>
      <Icon name="chevron-right" className="rl-go" size={24} />
    </Link>
  )
}

const TONE: Record<QualState, { tone: "bad" | "warn" | "ok" | "mute"; label: string }> = {
  expired: { tone: "bad", label: "Expired" }, due: { tone: "warn", label: "Due soon" }, valid: { tone: "ok", label: "Valid" }, open: { tone: "mute", label: "No expiry" },
}

/** One person's licences and skills (office only). The state pill is the API's verdict for what is saved; an edited row shows "Unsaved" until the API answers. */
function LicenceEditor({ people, truncated, today }: { people: RosterMember[]; truncated: boolean; today: string }) {
  const options = [...people].filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name))
  const [who, setWho] = useState("")
  const [saved, setSaved] = useState<Qualification[] | null>(null)
  const [rows, setRows] = useState<QualDraft[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const ask = useRef(0)
  const busy = useRef(false)

  async function pick(id: string) {
    setWho(id)
    setError("")
    setSaved(null)
    setRows([])
    if (!id) return
    const n = ++ask.current
    setLoading(true)
    const r = await readQualifications(id)
    if (n !== ask.current) return // another person was picked meanwhile
    setLoading(false)
    if (!r.ok) return setError(r.error.toast?.text ?? "Couldn't load.")
    setSaved(r.value)
    setRows(qualDrafts(r.value))
  }
  const stateOf = (row: QualDraft): QualState | null => {
    const q = saved?.find((s) => sameKey(s.type, row.type) && (s.expiresOn ?? "") === row.expiresOn)
    return q ? qualState(q) : null
  }
  const dirty = saved !== null && (saved.length !== rows.length || rows.some((r, i) => !sameKey(saved[i]!.type, r.type) || (saved[i]!.expiresOn ?? "") !== r.expiresOn))
  const patch = (i: number, p: Partial<QualDraft>) => { setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r))); setError("") }

  async function save(): Promise<boolean> {
    if (busy.current || !who) return false
    const bad = validateQuals(rows)
    setError(bad ?? "")
    if (bad) return false
    busy.current = true
    try {
      const r = await setQualifications(who, qualBody(rows))
      if (!r.ok) {
        setError(r.error.toast?.text ?? "Not saved.")
        return false
      }
      setSaved(r.value)
      setRows(qualDrafts(r.value))
      toast.success("Licences saved")
      return true
    } finally {
      busy.current = false
    }
  }

  const counts = saved ? { expired: saved.filter((q) => q.expired).length, due: saved.filter((q) => q.dueSoon).length } : null
  return (
    <div className="card nt-card rl-lic">
      <div className="od-form nt-form">
        <FormSection icon="verified" title="Licences" note={counts && (counts.expired || counts.due) ? `${counts.expired} expired · ${counts.due} due` : undefined}>
          <div className="rl-lic-who">
            <FilterSelect label="Person" value={who} options={[{ value: "", label: "Pick a person…" }, ...options.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => void pick(v)} />
            <CutHint cut={truncated} />
          </div>
          {loading && <p className="rl-note" aria-live="polite">Loading…</p>}
          {saved !== null && (
            <>
              {rows.length === 0 && <p className="rl-empty">No licences.</p>}
              <ul className="rl-lic-list">
                {rows.map((row, i) => {
                  const st = stateOf(row)
                  return (
                    <li key={i} className="rl-lic-row">
                      <Input aria-label={`Licence ${i + 1}`} placeholder="SIA licence" value={row.type} onChange={(e) => patch(i, { type: e.target.value })} />
                      <DatePicker label={`Expires ${i + 1}`} placeholder="No expiry" value={row.expiresOn} today={today} onChange={(v) => patch(i, { expiresOn: v })} />
                      <span className="rl-lic-st" title={row.expiresOn ? formatDate(row.expiresOn) : undefined}>
                        <StatusPill status={st ? TONE[st] : { tone: "mute", label: "Unsaved" }} tick={false} />
                      </span>
                      <button type="button" className="fs-act bad" aria-label={`Remove licence ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Icon name="trash" size={24} /></button>
                    </li>
                  )
                })}
              </ul>
              {error && <p className="rl-err" role="alert">{error}</p>}
              <div className="rl-tpl-foot">
                <button type="button" className="fs-act" onClick={() => setRows((rs) => [...rs, { type: "", expiresOn: "" }])}><Icon name="plus" size={24} />Add licence</button>
                <ActionButton className="btn btn-primary mr-btn" disabled={!dirty} onAction={save}>Save</ActionButton>
              </div>
            </>
          )}
          {saved === null && error && <p className="rl-err" role="alert">{error}</p>}
        </FormSection>
      </div>
    </div>
  )
}
