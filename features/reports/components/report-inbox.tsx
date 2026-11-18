"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { DatePicker } from "@/components/date-picker"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSeg, FilterSelect } from "@/components/filter-bar"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { useDept } from "@/hooks/use-dept"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { formatDate } from "@/lib/dates"
import { EMPTY_REPORT_FILTERS, windowLabel } from "@/lib/shift-report"
import { toInboxRow } from "../adapters"
import { inboxQuery } from "../query"
import { reportStateAt, isLateAt } from "../time"
import { useUrlFilters } from "@/hooks/use-url-filters"
import { REPORT_PAGE_SIZE, REPORT_STATE, REPORT_STATE_ORDER } from "../types"
import type { InboxRow, ReportFilters, ReportsData } from "../types"
import { ExportMenu } from "./export-menu"

const STATUSES = [{ value: "all", label: "All statuses" }, ...REPORT_STATE_ORDER.map((s) => ({ value: s, label: REPORT_STATE[s].label }))]

/** Where a row opens: a stored report by its uuid; the member's OWN virtual row by its key (the page opens the report first); someone else's virtual row has nothing to open. */
export const rowHref = (r: Pick<InboxRow, "reportId" | "key" | "userId">, meId: string): string | null =>
  r.reportId ? `/daily-reports/${r.reportId}` : r.userId === meId ? `/daily-reports/${encodeURIComponent(r.key)}` : null

/**
 * Report inbox (FR-M1-28): every report per person and per shift in the caller's scope, as the API returns them (stored reports AND virtual rows for a shift with no report yet). Filters live in
 * the URL and are answered by the server; the pages are the API's cursor ("Load more", also when the department switcher hides every loaded row but a cursor remains, N3). Nothing here
 * widens or narrows the scope. On phones the table stacks (.rtable). Export (FR-M1-31) is a server job for the current filters.
 */
export function ReportInbox({
  data,
  nowAt,
  today,
  tz,
  tzLabel,
  initialFilters = EMPTY_REPORT_FILTERS,
}: {
  data: ReportsData
  nowAt: string
  /** Tenant wall now (date words only). */
  today: string
  tz: string
  tzLabel: string
  initialFilters?: ReportFilters
}) {
  const own = data.scope === "own"
  const dept = useDept()
  const { filters, set, reset, pending } = useUrlFilters<ReportFilters>(initialFilters, EMPTY_REPORT_FILTERS)
  const [more, setMore] = useState<{ base: InboxRow[]; rows: InboxRow[]; cursor: string | null }>({ base: data.rows, rows: [], cursor: data.nextCursor })
  const [loading, setLoading] = useState(false)
  const fresh = more.base === data.rows
  const loaded = useMemo(() => (fresh ? [...data.rows, ...more.rows] : data.rows), [fresh, data.rows, more.rows])
  const cursor = fresh ? more.cursor : data.nextCursor
  const people = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people])
  const owners = useMemo(() => data.people.map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label)), [data.people])
  // The topbar department switcher acts as the team filter too (teams = departments, SRS A.5); the API has no such filter beside `team`, so it narrows the loaded rows only.
  const rows = dept === "all" ? loaded : loaded.filter((r) => r.team === dept)
  const states = useMemo(() => new Map(loaded.map((r) => [r.id, reportStateAt(r, nowAt)])), [loaded, nowAt])
  const filtered = dept !== "all" || Object.entries(filters).some(([k, v]) => v !== EMPTY_REPORT_FILTERS[k as keyof ReportFilters])

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    try {
      const page = await apiBrowser.get("/v1/shift-reports", { query: inboxQuery(filters, data.teams, { cursor, limit: REPORT_PAGE_SIZE }) as never })
      setMore({ base: data.rows, rows: [...(fresh ? more.rows : []), ...page.items.map((d) => toInboxRow(d, tz))], cursor: page.nextCursor })
    } catch (e) {
      toast.error(userMessage(e).text)
    } finally {
      setLoading(false)
    }
  }

  const exportReq = {
    from: filters.from || data.range.from,
    to: filters.to || data.range.to,
    ...(filters.team !== "all" ? { team: data.teams.find((t) => t.name === filters.team)?.id } : {}),
    ...(filters.person !== "all" ? { person: filters.person } : {}),
    ...(filters.status !== "all" ? { status: filters.status as never } : {}),
  }

  return (
    <section className="card sr-inbox" aria-labelledby="sr-inbox-h" aria-busy={pending || undefined}>
      <div className="card-head">
        <div>
          <h2 id="sr-inbox-h">{own ? "My reports" : "Report inbox"}</h2>
          <div className="sub">
            {rows.length}{cursor ? "+" : ""} {rows.length === 1 ? "report" : "reports"} · {formatDate(filters.from || data.range.from)} to {formatDate(filters.to || data.range.to)}
          </div>
        </div>
        <ExportMenu label="Date range" request={exportReq} />
      </div>
      {!own && (
        <div className="sr-counts">
          <FilterSeg label="Reports by status" value={filters.status} options={[{ value: "all", label: "All" }, ...REPORT_STATE_ORDER.filter((s) => s !== "draft").map((s) => ({ value: s, label: REPORT_STATE[s].label }))]} onChange={(v) => set("status", v)} />
        </div>
      )}
      <FilterBar>
        <div className="rep-date">
          <DatePicker value={filters.from} onChange={(v) => set("from", v)} placeholder="From date" label="From date" today={today} />
        </div>
        <div className="rep-date">
          <DatePicker value={filters.to} onChange={(v) => set("to", v)} placeholder="To date" label="To date" today={today} min={filters.from || undefined} />
        </div>
        {!own && data.teams.length > 1 && (
          <FilterSelect label="Team" value={filters.team} options={[{ value: "all", label: "All teams" }, ...data.teams.map((t) => ({ value: t.name, label: t.name }))]} onChange={(v) => set("team", v)} />
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
              <tbody>
                {rows.map((r) => {
                  const p = people.get(r.userId)
                  const s = states.get(r.id) ?? reportStateAt(r, nowAt)
                  const late = isLateAt(r)
                  const href = rowHref(r, data.meId)
                  const title = `${formatDate(r.date)} · ${r.shiftName}`
                  return (
                    <tr key={r.id}>
                      <td data-label="Shift">
                        {href ? <Link href={href} className="tt rep-link">{title}</Link> : <span className="tt">{title}</span>}
                        <div className="tm num">{windowLabel(r)} · due <When iso={r.due} today={today} tzLabel="" mode="time" /></div>
                      </td>
                      {!own && (
                        <td data-label="Person">
                          {p ? (
                            <div className="pers">
                              <span className={`avatar ${p.avatar}`}>{p.initials}</span>
                              <div><div className="tt">{p.name}</div><div className="tm">{p.role}</div></div>
                            </div>
                          ) : (
                            <div className="tt">{r.person}</div>
                          )}
                        </td>
                      )}
                      <td data-label="Team"><span className="dep-tag">{r.team}</span></td>
                      <td data-label="Status"><StatusPill status={REPORT_STATE[s]} /></td>
                      <td data-label="Submitted" className={`num due ${late ? "due-late" : ""}`}>
                        {r.submittedAt ? <When iso={r.submittedAt} today={today} tzLabel={tzLabel} /> : "Not submitted"}
                        {late && s !== "late" ? " · late" : ""}
                      </td>
                      <td data-label="Tasks" className="num">
                        {r.itemCount === 0 && !r.reportId ? "—" : `${r.doneCount}/${r.itemCount} done`}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {cursor && (
            <div className="tasks-more">
              <button type="button" className="btn btn-outline" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more"}</button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon="report"
          title="No reports match"
          text={filtered ? "Try a different date range or clear the filters." : own ? "Reports appear here once a shift with reporting starts." : "No shifts with reporting in this period."}
          action={
            filtered ? (
              <button type="button" className="btn btn-outline" onClick={reset}>
                Clear filters
              </button>
            ) : undefined
          }
        />
      )}
      {rows.length === 0 && cursor && (
        // The department switcher narrows only the rows loaded so far: more pages may hold matches, so the result must not look complete (N3).
        <div className="tasks-more">
          <p className="td-muted">Only the reports loaded so far were checked.</p>
          <button type="button" className="btn btn-outline" disabled={loading} onClick={() => void loadMore()}>{loading ? "Loading…" : "Load more"}</button>
        </div>
      )}
    </section>
  )
}
