"use client"

import { Fragment, useMemo, useState } from "react"

import { DataPagination, PagedBody } from "@/components/data-pagination"
import { DatePicker } from "@/components/date-picker"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { paginate } from "@/lib/paginate"
import { actionInfo } from "../actions-catalogue"
import { AUDIT_LIMIT, exportUrl, loadAudit } from "../adapters"
import { AUDIT_PAGE_SIZE, EMPTY_FILTERS, filterEvents } from "../filters"
import type { AuditEvent, AuditFilters } from "../types"

const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b))

// The log is the API's newest 1,000 entries. Record type and dates are the API's own query (a change re-reads it); actor, action and text filter the loaded page.
// The CSV is the API's download (streamed through the BFF, audited by the API), never built here.
export function AuditView({
  events: seed,
  today,
  tzLabel,
  timezone,
  names,
}: {
  events: AuditEvent[]
  today: string
  tzLabel: string
  timezone: string
  /** Actor id -> display name for events loaded after the first page (the page's own lookup, as plain data). */
  names: Record<string, string>
}) {
  const [events, setEvents] = useState(seed)
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof AuditFilters>(k: K, v: AuditFilters[K]) => {
    const next = { ...filters, [k]: v }
    setFilters(next)
    setPage(1)
    setOpen(null)
    // record type and dates are the API's filters: re-read the log for them
    if (k === "recordType" || k === "from" || k === "to") {
      setBusy(true)
      setError(null)
      loadAudit(apiBrowser, next, timezone, (id) => names[id] ?? id)
        .then(setEvents)
        .catch((e: unknown) => setError(userMessage(e).text))
        .finally(() => setBusy(false))
    }
  }

  const actors = useMemo(() => [{ value: "all", label: "All actors" }, ...uniq(events.map((e) => e.actor)).map((a) => ({ value: a, label: a }))], [events])
  const actions = useMemo(
    () => [
      { value: "all", label: "All actions" },
      ...uniq(events.map((e) => e.action)).map((a) => ({ value: a, label: actionInfo(a).label })),
    ],
    [events],
  )
  const types = useMemo(() => [{ value: "all", label: "All records" }, ...uniq(events.map((e) => e.recordType)).map((t) => ({ value: t, label: t }))], [events])

  const rows = useMemo(() => filterEvents(events, filters), [events, filters])
  const pg = paginate(rows, page, AUDIT_PAGE_SIZE)
  const flagged = events.filter((e) => e.sensitive).length

  return (
    <>
      <PageHead
        title="Audit Log"
        subtitle="Who did what, when and from where"
        actions={
          <a className="btn btn-outline" href={exportUrl(filters, timezone)} download>
            Export CSV
          </a>
        }
      />
      <div className="card au-card">
        <p className="au-note">
          <Icon name="lock" />
          <span>
            Audit records can&apos;t be edited or deleted. {flagged} sensitive actions are flagged.{events.length >= AUDIT_LIMIT ? ` Showing the latest ${AUDIT_LIMIT.toLocaleString("en")}: narrow the dates or export the CSV for the rest.` : ""}
          </span>
        </p>
        <FilterBar>
          <FilterSelect label="Actor" value={filters.actor} options={actors} onChange={(v) => set("actor", v)} />
          <FilterSelect label="Action" value={filters.action} options={actions} onChange={(v) => set("action", v)} />
          <FilterSelect label="Record type" value={filters.recordType} options={types} onChange={(v) => set("recordType", v)} />
          <DatePicker value={filters.from} onChange={(v) => set("from", v)} today={today} label="From date" placeholder="From" />
          <DatePicker value={filters.to} onChange={(v) => set("to", v)} today={today} min={filters.from || undefined} label="To date" placeholder="To" />
          <FilterSearch value={filters.q} onChange={(v) => set("q", v)} placeholder="Search events" />
        </FilterBar>
        {error ? (
          <EmptyState icon="history" title="Couldn't load the log" text={error} />
        ) : rows.length === 0 ? (
          <EmptyState icon="history" title="No events match" text="Try a different actor, action or date range." />
        ) : (
          <>
            <div className="table-wrap" aria-busy={busy}>
              <table className="rtable au-table">
                <thead>
                  <tr><th>Time</th><th>Actor</th><th>Action</th><th>Record</th><th>Details</th></tr>
                </thead>
                <PagedBody page={pg.page}>
                  {pg.rows.map((e) => {
                    const isOpen = open === e.id
                    return (
                      <Fragment key={e.id}>
                        <tr className={e.sensitive ? "au-sens" : undefined}>
                          <td data-label="Time" className="num">
                            <div className="tt">{e.at.slice(0, 10) === today.slice(0, 10) ? "Today" : <When iso={e.at} today={today} tzLabel={tzLabel} mode="date" />}</div>
                            <div className="tm"><When iso={e.at} today={today} tzLabel={tzLabel} mode="time" /></div>
                          </td>
                          <td data-label="Actor">
                            <div className="tt">{e.actor}</div>
                          </td>
                          <td data-label="Action">
                            <StatusPill status={actionInfo(e.action)} />
                            {e.sensitive && <span className="au-flag">Sensitive</span>}
                          </td>
                          <td data-label="Record">
                            <div className="tt">{e.recordType}</div>
                            <div className="tm num">{e.recordRef}</div>
                          </td>
                          <td data-label="Details">
                            <button
                              type="button"
                              className="au-toggle"
                              aria-expanded={isOpen}
                              aria-controls={isOpen ? `au-${e.id}` : undefined}
                              onClick={() => setOpen(isOpen ? null : e.id)}
                            >
                              {isOpen ? "Hide" : "Show"}
                              <span className="sr-only"> details for {e.id}</span>
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="au-meta-row" id={`au-${e.id}`}>
                            <td colSpan={5}>
                              <dl className="au-meta">
                                <div><dt>Event</dt><dd className="num">{e.id}</dd></div>
                                {Object.entries(e.meta).map(([k, v]) => (
                                  <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
                                ))}
                              </dl>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </PagedBody>
              </table>
            </div>
            <DataPagination {...pg} label="Audit log pages" onPageChange={(p) => { setPage(p); setOpen(null) }} />
          </>
        )}
      </div>
    </>
  )
}
