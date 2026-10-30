"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

import { DataPagination, PagedBody } from "@/components/data-pagination"
import { DatePicker } from "@/components/date-picker"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSeg, FilterSelect } from "@/components/filter-bar"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { useDept } from "@/hooks/use-dept"
import { formatDate } from "@/lib/dates"
import { paginate } from "@/lib/paginate"
import { EMPTY_REPORT_FILTERS, isLate, matchesReport, minutesText, reportState, totalMinutes, windowLabel } from "@/lib/shift-report"
import type { ExportMeta } from "../export"
import { buildRangeDoc } from "../export-rows"
import { REPORT_PAGE_SIZE, REPORT_STATE, REPORT_STATE_ORDER } from "../types"
import type { ReportFilters, ReportsSeed, ShiftReport } from "../types"
import { ExportMenu } from "./export-menu"

const STATUSES = [{ value: "all", label: "All statuses" }, ...REPORT_STATE_ORDER.map((s) => ({ value: s, label: REPORT_STATE[s].label }))]

/**
 * Report inbox (FR-M1-28): every report per person and per shift in the viewer's scope, filtered by date range, team,
 * person and status, paginated; on phones the table stacks (.rtable). Export (FR-M1-31) writes the filtered date range.
 */
export function ReportInbox({
  reports,
  seed,
  now,
  tz,
  tzLabel,
  initialFilters = EMPTY_REPORT_FILTERS,
  exportMeta,
}: {
  reports: ShiftReport[]
  seed: ReportsSeed
  now: string
  tz: string
  tzLabel: string
  initialFilters?: ReportFilters
  exportMeta: ExportMeta
}) {
  const own = seed.scope === "own"
  const dept = useDept()
  const [filters, setFilters] = useState<ReportFilters>(initialFilters)
  const [page, setPage] = useState(1)
  const [seenDept, setSeenDept] = useState(dept)
  if (seenDept !== dept) {
    setSeenDept(dept)
    setPage(1)
  }
  const set = <K extends keyof ReportFilters>(k: K, v: ReportFilters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
  }
  const people = useMemo(() => new Map(seed.people.map((p) => [p.id, p])), [seed.people])
  const states = useMemo(() => new Map(reports.map((r) => [r.id, reportState(r, now, tz)])), [reports, now, tz])
  const owners = useMemo(
    () => [...new Set(reports.map((r) => r.personId))].map((id) => ({ value: id, label: people.get(id)?.name ?? id })).sort((a, b) => a.label.localeCompare(b.label)),
    [reports, people],
  )
  // The topbar department filter acts as the team filter too (teams = departments, SRS A.5).
  const rows = useMemo(
    () => reports.filter((r) => (dept === "all" || r.team === dept) && matchesReport(r, states.get(r.id)!, filters)),
    [reports, dept, states, filters],
  )
  const paged = paginate(rows, page, REPORT_PAGE_SIZE)
  const filtered = dept !== "all" || Object.entries(filters).some(([k, v]) => v !== EMPTY_REPORT_FILTERS[k as keyof ReportFilters])
  const dates = rows.map((r) => r.date).sort()
  const doc = rows.length
    ? buildRangeDoc({ rows, people, states, from: filters.from || dates[0], to: filters.to || dates.at(-1)!, tz })
    : null
  const counts = REPORT_STATE_ORDER.filter((s) => s !== "draft").map((s) => [s, reports.filter((r) => states.get(r.id) === s).length] as const)

  return (
    <section className="card sr-inbox" aria-labelledby="sr-inbox-h">
      <div className="card-head">
        <div>
          <h2 id="sr-inbox-h">{own ? "My reports" : "Report inbox"}</h2>
          <div className="sub">
            {rows.length} of {reports.length} reports · {formatDate(seed.range.from)} to {formatDate(seed.range.to)}
          </div>
        </div>
        <ExportMenu groups={[{ key: "range", label: "Date range", doc }]} meta={exportMeta} />
      </div>
      {!own && (
        <div className="sr-counts">
          <FilterSeg
            label="Reports by status"
            value={filters.status}
            options={[
              { value: "all", label: <>All <span className="num">{reports.length}</span></> },
              ...counts.map(([s, n]) => ({ value: s, label: <>{REPORT_STATE[s].label} <span className="num">{n}</span></> })),
            ]}
            onChange={(v) => set("status", v)}
          />
        </div>
      )}
      <FilterBar>
        <div className="rep-date">
          <DatePicker value={filters.from} onChange={(v) => set("from", v)} placeholder="From date" label="From date" today={now} min={seed.range.from} />
        </div>
        <div className="rep-date">
          <DatePicker value={filters.to} onChange={(v) => set("to", v)} placeholder="To date" label="To date" today={now} min={filters.from || seed.range.from} />
        </div>
        {!own && seed.teams.length > 1 && (
          <FilterSelect label="Team" value={filters.team} options={[{ value: "all", label: "All teams" }, ...seed.teams.map((t) => ({ value: t, label: t }))]} onChange={(v) => set("team", v)} />
        )}
        {!own && <FilterSelect label="Person" value={filters.person} options={[{ value: "all", label: "All people" }, ...owners]} onChange={(v) => set("person", v)} />}
        <FilterSelect label="Status" value={filters.status} options={STATUSES} onChange={(v) => set("status", v)} />
      </FilterBar>
      {rows.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="rtable rep-table sr-table">
              <thead>
                <tr>
                  <th>Shift</th>
                  {!own && <th>Person</th>}
                  <th>Team</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Tasks</th>
                </tr>
              </thead>
              <PagedBody page={paged.page}>
                {paged.rows.map((r) => {
                  const p = people.get(r.personId)
                  const s = states.get(r.id)!
                  const late = isLate(r, tz)
                  return (
                    <tr key={r.id}>
                      <td data-label="Shift">
                        <Link href={`/daily-reports/${encodeURIComponent(r.id)}`} className="tt rep-link">
                          {formatDate(r.date)} · {r.shiftName}
                        </Link>
                        <div className="tm num">{windowLabel(r)} · due <When iso={r.due} today={now} tzLabel="" mode="time" /></div>
                      </td>
                      {!own && (
                        <td data-label="Person">
                          {p && (
                            <div className="pers">
                              <span className={`avatar ${p.avatar}`}>{p.initials}</span>
                              <div><div className="tt">{p.name}</div><div className="tm">{p.role}</div></div>
                            </div>
                          )}
                        </td>
                      )}
                      <td data-label="Team"><span className="dep-tag">{r.team}</span></td>
                      <td data-label="Status"><StatusPill status={REPORT_STATE[s]} /></td>
                      <td data-label="Submitted" className={`num due ${late ? "due-late" : ""}`}>
                        {r.submittedAt ? <When iso={r.submittedAt} today={now} tzLabel={tzLabel} /> : "Not submitted"}
                        {late && s !== "late" ? " · late" : ""}
                      </td>
                      <td data-label="Tasks" className="num">
                        {r.items.length} · {minutesText(totalMinutes(r))}
                      </td>
                    </tr>
                  )
                })}
              </PagedBody>
            </table>
          </div>
          <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Report pages" onPageChange={setPage} />
        </>
      ) : (
        <EmptyState
          icon="report"
          title="No reports match"
          text={filtered ? "Try a different date range or clear the filters." : own ? "Reports appear here once a shift with reporting starts." : "No shifts with reporting in this period."}
          action={
            filtered ? (
              <button type="button" className="btn btn-outline" onClick={() => { setFilters(EMPTY_REPORT_FILTERS); setPage(1) }}>
                Clear filters
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  )
}
