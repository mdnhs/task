"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"

import { CountUp } from "@/components/count-up"
import { DataPagination, useSlideDir } from "@/components/data-pagination"
import { DetailSheet } from "@/components/detail-sheet"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect, FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { useDept } from "@/hooks/use-dept"
import { nowInTz } from "@/lib/dates"
import { paginate } from "@/lib/paginate"
import { rosterStats } from "../stats"
import { gapsStore, incidentsStore } from "../store"
import { COVERAGE, INCIDENT_STATUS, INCIDENT_TYPE, STAFF_PAGE_SIZE, WHEN_ORDER } from "../types"
import type { Coverage, HistoryEntry, Incident, IncidentStatus, IncidentType, RosterGap, StaffMember } from "../types"
import { AttendanceList } from "./attendance-list"
import { CoverDialog } from "./cover-dialog"
import { GapDialog } from "./gap-dialog"
import { GapDetail, IncidentDetail } from "./details"
import { IncidentDialog } from "./incident-dialog"
import type { IncidentInput } from "./incident-dialog"
import { GapsList } from "./gaps-list"

type Tab = "attendance" | "gaps"
const TABS: { value: Tab; label: string }[] = [
  { value: "attendance", label: "Attendance" },
  { value: "gaps", label: "Roster gaps" },
]
const TYPE_OPTIONS = [{ value: "all", label: "All types" }, ...(Object.keys(INCIDENT_TYPE) as IncidentType[]).map((t) => ({ value: t, label: INCIDENT_TYPE[t] }))]
const STATUS_OPTIONS = [{ value: "all", label: "All statuses" }, ...(Object.keys(INCIDENT_STATUS) as IncidentStatus[]).map((s) => ({ value: s, label: INCIDENT_STATUS[s].label }))]
const COVERAGE_OPTIONS = [{ value: "all", label: "All coverage" }, ...(Object.keys(COVERAGE) as Coverage[]).map((c) => ({ value: c, label: COVERAGE[c].label }))]

const has = (q: string, ...fields: (string | null | undefined)[]) => fields.some((f) => (f ?? "").toLowerCase().includes(q))

const inDept = <T extends { dept: string }>(rows: T[], dept: string) => (dept === "all" ? rows : rows.filter((r) => r.dept === dept))

export function StaffRostersView({
  incidents,
  gaps,
  staff,
  today,
  tz,
  tzLabel,
  canWrite,
  sensitive,
  actor,
  scopeKey,
}: {
  incidents: Incident[]
  gaps: RosterGap[]
  staff: StaffMember[]
  today: string
  /** IANA timezone from the org settings; stamps history entries. */
  tz: string
  tzLabel: string
  /** Create and edit controls (role write access and an active tenant). */
  canWrite: boolean
  /** Contact and notes are shown (FR-STAFF-03); the server already dropped them when false. */
  sensitive: boolean
  actor: string
  /** Names what the data was scoped for (tenant + role). When it changes, the stores are reseeded. */
  scopeKey: string
}) {
  const dept = useDept()
  const [allIncidents, setIncidents] = incidentsStore.useStore(incidents, scopeKey)
  const [allGaps, setGaps] = gapsStore.useStore(gaps, scopeKey)
  const [tab, setTab] = useState<Tab>("attendance")
  const [q, setQ] = useState("")
  const [type, setType] = useState("all")
  const [status, setStatus] = useState("all")
  const [coverage, setCoverage] = useState("all")
  const [pages, setPages] = useState<Record<Tab, number>>({ attendance: 1, gaps: 1 })
  const [seenDept, setSeenDept] = useState(dept)
  const [openIncident, setOpenIncident] = useState<string>()
  const [openGap, setOpenGap] = useState<string>()
  const [incidentSheet, setIncidentSheet] = useState(false)
  const [gapSheet, setGapSheet] = useState(false)
  const [logging, setLogging] = useState(false)
  const [covering, setCovering] = useState(false)
  const [editingGap, setEditingGap] = useState(false)

  const resetPage = () => setPages({ attendance: 1, gaps: 1 })
  if (seenDept !== dept) {
    setSeenDept(dept)
    resetPage()
  }
  const filter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    resetPage()
  }

  const scopedIncidents = useMemo(() => inDept(allIncidents, dept), [allIncidents, dept])
  const scopedGaps = useMemo(() => inDept(allGaps, dept), [allGaps, dept])
  const stats = rosterStats(scopedIncidents, scopedGaps, today)

  const incidentRows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return scopedIncidents
      .filter((i) => (type === "all" || i.type === type) && (status === "all" || i.status === status) && (!s || has(s, i.staff, i.site, i.client, i.id, i.cover, i.owner)))
      .sort((a, b) => b.reportedAt.localeCompare(a.reportedAt))
  }, [scopedIncidents, q, type, status])
  const gapRows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return scopedGaps
      .filter((g) => (coverage === "all" || g.coverage === coverage) && (!s || has(s, g.site, g.client, g.role, g.assigned, g.owner, g.id)))
      .sort((a, b) => WHEN_ORDER.indexOf(a.when) - WHEN_ORDER.indexOf(b.when) || a.shiftStart.localeCompare(b.shiftStart))
  }, [scopedGaps, q, coverage])

  const pagedIncidents = paginate(incidentRows, pages.attendance, STAFF_PAGE_SIZE)
  const pagedGaps = paginate(gapRows, pages.gaps, STAFF_PAGE_SIZE)
  const pager = tab === "attendance" ? pagedIncidents : pagedGaps
  const tabDir = useSlideDir(TABS.findIndex((t) => t.value === tab))

  const incident = allIncidents.find((i) => i.id === openIncident)
  const gap = allGaps.find((g) => g.id === openGap)
  // Local filters only: "Clear filters" cannot reset the global department filter.
  const local = tab === "attendance" ? !!q || type !== "all" || status !== "all" : !!q || coverage !== "all"
  const filtered = local || dept !== "all"
  const total = tab === "attendance" ? scopedIncidents.length : scopedGaps.length

  const entry = (action: string, note?: string): HistoryEntry => ({ at: nowInTz(today, tz), by: actor, action, ...(note ? { note } : {}) })
  const patchIncident = (id: string, patch: Partial<Incident>, h: HistoryEntry) =>
    setIncidents((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch, history: [...i.history, h] } : i)))

  function logIncident(v: IncidentInput) {
    let id = ""
    const dept = staff.find((s) => s.name === v.staff)?.dept ?? ""
    setIncidents((prev) => {
      const max = prev.reduce((m, i) => Math.max(m, parseInt(i.id.replace(/\D/g, ""), 10) || 0), 0)
      id = `INC-${max + 1}`
      const h = entry("Incident logged")
      const created: Incident = {
        id, type: v.type, staff: v.staff, dept, shift: v.shift, site: v.site, client: v.client, cover: null, status: "open",
        owner: actor, action: v.action, reportedAt: h.at, history: [h],
        ...(v.contact ? { contact: v.contact } : {}), ...(v.notes ? { notes: v.notes } : {}),
      }
      return [created, ...prev]
    })
    toast.success(`${id} logged`)
    setTab("attendance")
    resetPage()
  }

  function recordCover(id: string, cover: string, action: string) {
    patchIncident(id, { cover, action, status: "covered" }, entry("Cover recorded", `${cover} is covering`))
    toast.success(`Cover recorded: ${cover}`)
  }
  function setIncidentStatus(i: Incident, next: IncidentStatus, label: string) {
    patchIncident(i.id, { status: next }, entry(label))
    toast.success(`${i.id}: ${label.toLowerCase()}`)
  }
  function saveGap(id: string, v: { coverage: Coverage; assigned: string; nextAction: string }) {
    const note = v.assigned ? `${COVERAGE[v.coverage].label}, ${v.assigned}` : COVERAGE[v.coverage].label
    setGaps((prev) => prev.map((g) => (g.id === id ? { ...g, ...v, history: [...g.history, entry("Cover updated", note)] } : g)))
    toast.success(`${id} updated: ${COVERAGE[v.coverage].label.toLowerCase()}`)
  }

  const statCards: { key: string; title: string; value: number; note: string; hero?: boolean }[] = [
    { key: "unc", title: "Uncovered tomorrow", value: stats.uncoveredTomorrow, note: "Shifts with nobody assigned" },
    { key: "gap", title: "Gaps next week", value: stats.gapsNextWeek, note: "Uncovered or partly covered" },
    { key: "co", title: "Call-outs covered today", value: stats.calloutsCoveredToday, note: "Cover recorded" },
    { key: "open", title: "Open incidents", value: stats.openIncidents, note: "Open or escalated" },
  ]

  return (
    <>
      <PageHead
        title="Staff & Rosters"
        subtitle={`${scopedIncidents.length} incidents · ${scopedGaps.length} roster gaps`}
        actions={
          canWrite && (
            <button type="button" className="btn btn-primary" onClick={() => setLogging(true)}>
              <Icon name="plus" />
              Log incident
            </button>
          )
        }
      />
      <section className="stats" aria-label="Summary">
        {statCards.map((s, i) => (
          <article key={s.key} className="stat">
            <div className="stat-top"><h3>{s.title}</h3></div>
            <div className="value num"><CountUp value={String(s.value)} delay={0.1 + i * 0.04} /></div>
            <div className="note">{s.note}</div>
          </article>
        ))}
      </section>
      <div className="card sr-card">
        <FilterBar>
          <FilterSeg
            label="View"
            value={tab}
            options={TABS}
            onChange={(v) => {
              setTab(v)
              resetPage()
            }}
          />
          <FilterSearch value={q} onChange={filter(setQ)} placeholder={tab === "attendance" ? "Search incidents" : "Search roster gaps"} />
          {tab === "attendance" ? (
            <>
              <FilterSelect label="Type" value={type} options={TYPE_OPTIONS} onChange={filter(setType)} />
              <FilterSelect label="Status" value={status} options={STATUS_OPTIONS} onChange={filter(setStatus)} />
            </>
          ) : (
            <FilterSelect label="Coverage" value={coverage} options={COVERAGE_OPTIONS} onChange={filter(setCoverage)} />
          )}
        </FilterBar>
        {pager.total > 0 ? (
          <>
            {/* Gaps (second tab) slides in from the right, Attendance from the left. */}
            <div key={tab} className="od-slide" data-slide={tabDir}>
              {tab === "attendance" ? (
                <AttendanceList rows={pagedIncidents.rows} page={pagedIncidents.page} today={today} tzLabel={tzLabel} onOpen={(id) => { setOpenIncident(id); setIncidentSheet(true) }} />
              ) : (
                <GapsList rows={pagedGaps.rows} page={pagedGaps.page} tzLabel={tzLabel} onOpen={(id) => { setOpenGap(id); setGapSheet(true) }} />
              )}
            </div>
            <DataPagination
              page={pager.page}
              pageCount={pager.pageCount}
              total={pager.total}
              from={pager.from}
              to={pager.to}
              label={tab === "attendance" ? "Incidents pages" : "Roster gaps pages"}
              onPageChange={(p) => setPages((x) => ({ ...x, [tab]: p }))}
            />
          </>
        ) : (
          <EmptyState
            icon="roster"
            title={tab === "attendance" ? "No incidents match" : "No roster gaps match"}
            text={filtered ? (local ? "Try a different search or clear the filters." : "Nothing in this department. Change the department filter to see more.") : total === 0 ? "Nothing has been logged yet." : "Nothing to show."}
            action={
              local ? (
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => {
                    setQ("")
                    setType("all")
                    setStatus("all")
                    setCoverage("all")
                    resetPage()
                  }}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        )}
      </div>

      <DetailSheet
        open={incidentSheet && !!incident}
        onOpenChange={setIncidentSheet}
        title={incident ? `${INCIDENT_TYPE[incident.type]}: ${incident.staff}` : "Incident"}
        subtitle={incident && <span className="sr-sheet-pills"><StatusPill status={INCIDENT_STATUS[incident.status]} /><span className="sr-ref num">{incident.id}</span></span>}
        footer={
          incident && canWrite && incident.status !== "resolved" ? (
            <>
              {incident.type !== "staff_issue" && !incident.cover && (
                <button type="button" className="btn btn-primary" onClick={() => { setIncidentSheet(false); setCovering(true) }}>Record cover</button>
              )}
              {incident.status === "open" && (
                <button type="button" className="btn btn-outline" onClick={() => setIncidentStatus(incident, "escalated", "Escalated")}>Escalate</button>
              )}
              <button type="button" className="btn btn-outline" onClick={() => setIncidentStatus(incident, "resolved", "Resolved")}>Mark resolved</button>
            </>
          ) : undefined
        }
      >
        {incident && <IncidentDetail incident={incident} sensitive={sensitive} today={today} tzLabel={tzLabel} />}
      </DetailSheet>
      <DetailSheet
        open={gapSheet && !!gap}
        onOpenChange={setGapSheet}
        title={gap ? `${gap.site} · ${gap.role}` : "Roster gap"}
        subtitle={gap && <span className="sr-sheet-pills"><StatusPill status={COVERAGE[gap.coverage]} /><span className="sr-ref num">{gap.id}</span></span>}
        footer={
          gap && canWrite ? (
            <button type="button" className="btn btn-primary" onClick={() => { setGapSheet(false); setEditingGap(true) }}>Update cover</button>
          ) : undefined
        }
      >
        {gap && <GapDetail gap={gap} sensitive={sensitive} today={today} tzLabel={tzLabel} />}
      </DetailSheet>

      {canWrite && (
        <>
          <IncidentDialog open={logging} onOpenChange={setLogging} staff={staff} onCreate={logIncident} />
          <CoverDialog incident={incident} open={covering} onOpenChange={setCovering} staff={staff} onSave={recordCover} />
          <GapDialog gap={gap} open={editingGap} onOpenChange={setEditingGap} staff={staff} onSave={saveGap} />
        </>
      )}
    </>
  )
}
