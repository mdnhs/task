"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
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
import { rostersHref, rostersTab } from "../logic"
import type { RostersTab } from "../logic"
import { rosterStats } from "../stats"
import { gapsStore, incidentsStore } from "../store"
import { COVERAGE, INCIDENT_STATUS, INCIDENT_TYPE, STAFF_PAGE_SIZE, WHEN_ORDER } from "../types"
import type { Coverage, HistoryEntry, Incident, IncidentStatus, IncidentType, RosterGap, StaffMember } from "../types"
import { AttendanceList } from "./attendance-list"
import { CoverDialog } from "./cover-dialog"
import { IncidentDetail } from "./details"
import { GapsList } from "./gaps-list"

type Tab = RostersTab
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
  const [allGaps] = gapsStore.useStore(gaps, scopeKey)
  // `?tab=gaps` opens Roster gaps: the gap page and Log incident return to the tab they came from.
  const urlTab = rostersTab(useSearchParams().get("tab"))
  const [tab, setTab] = useState<Tab>(urlTab)
  const [q, setQ] = useState("")
  const [type, setType] = useState("all")
  const [status, setStatus] = useState("all")
  const [coverage, setCoverage] = useState("all")
  const [pages, setPages] = useState<Record<Tab, number>>({ attendance: 1, gaps: 1 })
  const [seenDept, setSeenDept] = useState(dept)
  const [openIncident, setOpenIncident] = useState<string>()
  const [incidentSheet, setIncidentSheet] = useState(false)
  const [covering, setCovering] = useState(false)

  const resetPage = () => setPages({ attendance: 1, gaps: 1 })
  // A link to /staff-rosters(?tab=…) while the page is open (sidebar, back link) switches the tab too.
  const [seenTab, setSeenTab] = useState(urlTab)
  if (seenTab !== urlTab) {
    setSeenTab(urlTab)
    if (tab !== urlTab) {
      setTab(urlTab)
      resetPage()
    }
  }
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
  // Local filters only: "Clear filters" cannot reset the global department filter.
  const local = tab === "attendance" ? !!q || type !== "all" || status !== "all" : !!q || coverage !== "all"
  const filtered = local || dept !== "all"
  const total = tab === "attendance" ? scopedIncidents.length : scopedGaps.length

  const entry = (action: string, note?: string): HistoryEntry => ({ at: nowInTz(today, tz), by: actor, action, ...(note ? { note } : {}) })
  const patchIncident = (id: string, patch: Partial<Incident>, h: HistoryEntry) =>
    setIncidents((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch, history: [...i.history, h] } : i)))

  function recordCover(id: string, cover: string, action: string) {
    patchIncident(id, { cover, action, status: "covered" }, entry("Cover recorded", `${cover} is covering`))
    toast.success(`Cover recorded: ${cover}`)
  }
  function setIncidentStatus(i: Incident, next: IncidentStatus, label: string) {
    patchIncident(i.id, { status: next }, entry(label))
    toast.success(`${i.id}: ${label.toLowerCase()}`)
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
            <Link href="/staff-rosters/incidents/new" className="btn btn-primary">
              <Icon name="plus" />
              Log incident
            </Link>
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
              // Keep the URL on the open tab (no server round trip), so Back and reload land on it.
              window.history.replaceState(null, "", rostersHref(v))
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
                <GapsList rows={pagedGaps.rows} page={pagedGaps.page} tzLabel={tzLabel} />
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
      {canWrite && <CoverDialog incident={incident} open={covering} onOpenChange={setCovering} staff={staff} onSave={recordCover} />}
    </>
  )
}
