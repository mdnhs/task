"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

import { DataPagination, PagedBody } from "@/components/data-pagination"
import { DatePicker } from "@/components/date-picker"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSelect } from "@/components/filter-bar"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { useDept } from "@/hooks/use-dept"
import { paginate } from "@/lib/paginate"
import type { ExportMeta } from "../export"
import { buildHistoryDoc } from "../export-rows"
import { ExportMenu } from "./export-menu"
import { EMPTY_FILTERS, REPORT_PAGE_SIZE, matchesFilters } from "../filters"
import { isLateSubmission } from "../lifecycle"
import { REPORT_STATUS, REPORT_STATUS_ORDER } from "../types"
import type { Report, ReportsFilters } from "../types"
import type { Person } from "@/lib/types"

const STATUSES = [{ value: "all", label: "All statuses" }, ...REPORT_STATUS_ORDER.map((s) => ({ value: s, label: REPORT_STATUS[s].label }))]

// Historical reports (SRS §10.3): filter by date range, department (global), owner and status. Export (FR-REP-12) writes the filtered rows to Excel or PDF.
export function ReportHistory({
  reports,
  people,
  today,
  tzLabel,
  deadline,
  initialFilters = EMPTY_FILTERS,
  showOwner,
  exportMeta,
}: {
  reports: Report[]
  people: Map<string, Person>
  today: string
  tzLabel: string
  deadline: string
  initialFilters?: ReportsFilters
  /** Staff only see their own reports, so the owner filter and column are dropped. */
  showOwner: boolean
  exportMeta: ExportMeta
}) {
  const dept = useDept()
  const [filters, setFilters] = useState<ReportsFilters>(initialFilters)
  const [page, setPage] = useState(1)
  const [seenDept, setSeenDept] = useState(dept)
  if (seenDept !== dept) {
    setSeenDept(dept)
    setPage(1)
  }
  const set = <K extends keyof ReportsFilters>(k: K, v: ReportsFilters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
  }
  const owners = useMemo(() => {
    const ids = [...new Set(reports.map((r) => r.owner))]
    return ids.map((id) => ({ value: id, label: people.get(id)?.name ?? id }))
  }, [reports, people])
  const rows = useMemo(
    () => reports.filter((r) => (dept === "all" || r.dept === dept) && matchesFilters(r, filters)).sort((a, b) => b.date.localeCompare(a.date) || a.dept.localeCompare(b.dept)),
    [reports, dept, filters],
  )
  const paged = paginate(rows, page, REPORT_PAGE_SIZE)
  const filtered = dept !== "all" || filters.from !== "" || filters.to !== "" || filters.owner !== "all" || filters.status !== "all"

  return (
    <section className="card rep-history">
      <div className="card-head">
        <div>
          <h2>{showOwner ? "Report history" : "My report history"}</h2>
          <div className="sub">{rows.length} of {reports.length} reports</div>
        </div>
        <ExportMenu groups={[{ key: "history", label: showOwner ? "Report history" : "My report history", doc: buildHistoryDoc({ reports: rows, people, today, deadline, showOwner }) }]} meta={exportMeta} />
      </div>
      <FilterBar>
        <div className="rep-date">
          <DatePicker value={filters.from} onChange={(v) => set("from", v)} placeholder="From date" label="From date" today={today} />
        </div>
        <div className="rep-date">
          <DatePicker value={filters.to} onChange={(v) => set("to", v)} placeholder="To date" label="To date" today={today} min={filters.from || undefined} />
        </div>
        {showOwner && (
          <FilterSelect label="Owner" value={filters.owner} options={[{ value: "all", label: "All owners" }, ...owners]} onChange={(v) => set("owner", v)} />
        )}
        <FilterSelect label="Status" value={filters.status} options={STATUSES} onChange={(v) => set("status", v)} />
      </FilterBar>
      {rows.length > 0 ? (
        <>
        <div className="table-wrap">
          <table className="rtable rep-table">
            <thead>
              <tr>
                <th>Report</th>
                <th>Dept</th>
                {showOwner && <th>Owner</th>}
                <th>Status</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <PagedBody page={paged.page}>
                {paged.rows.map((r) => {
                  const o = people.get(r.owner)
                  return (
                    <tr key={r.id}>
                      <td data-label="Report">
                        <Link href={`/daily-reports/${r.id}`} className="tt rep-link">
                          <When iso={`${r.date}T00:00:00`} today={today} tzLabel={tzLabel} mode="date" />
                        </Link>
                        <div className="tm num">{r.id}</div>
                      </td>
                      <td data-label="Dept"><span className="dep-tag">{r.dept}</span></td>
                      {showOwner && (
                        <td data-label="Owner">
                          {o && (
                            <div className="pers">
                              <span className={`avatar ${o.avatar}`}>{o.initials}</span>
                              <div><div className="tt">{o.name}</div><div className="tm">{o.role}</div></div>
                            </div>
                          )}
                        </td>
                      )}
                      <td data-label="Status"><StatusPill status={REPORT_STATUS[r.status]} /></td>
                      <td data-label="Submitted" className={`num due ${isLateSubmission(r, deadline) ? "due-late" : ""}`}>
                        {r.submittedAt ? <When iso={r.submittedAt} today={today} tzLabel={tzLabel} mode="time" /> : "Not submitted"}
                        {isLateSubmission(r, deadline) ? " · late" : ""}
                      </td>
                    </tr>
                  )
                })}
            </PagedBody>
          </table>
        </div>
        <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Report history pages" onPageChange={setPage} />
        </>
      ) : (
        <EmptyState
          icon="report"
          title="No reports match"
          text={filtered ? "Try a different date range or clear the filters." : "There are no reports yet."}
          action={
            filtered ? (
              <button type="button" className="btn btn-outline" onClick={() => {
                setFilters(EMPTY_FILTERS)
                setPage(1)
              }}>
                Clear filters
              </button>
            ) : undefined
          }
        />
      )}
    </section>
  )
}
