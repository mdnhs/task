"use client"

import { Fragment, useMemo, useRef, useState } from "react"

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
import { AUDIT_ACTIONS, actionInfo } from "../actions-catalogue"
import { exportUrl, loadAudit, nameFrom } from "../adapters"
import { AUDIT_PAGE_SIZE, EMPTY_FILTERS, SYSTEM_ACTOR, filterEvents } from "../filters"
import type { AuditEvent, AuditFilters } from "../types"

const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b))

// The log is the API's pages of 100, newest first. Actor, action, record type and dates are the API's own query (a change re-reads page one); "Load older" follows its cursor; only the text
// search and "System" filter the loaded rows. The CSV is the API's download (streamed through the BFF, audited by the API) with the same filters, never built here.
export function AuditView({
  events: seed,
  nextCursor: seedCursor,
  today,
  tzLabel,
  timezone,
  names,
}: {
  events: AuditEvent[]
  /** The API's cursor for the next, older page (null when the first page is all there is). */
  nextCursor: string | null
  today: string
  tzLabel: string
  timezone: string
  /** Actor id -> display name for events loaded after the first page (the page's own lookup, as plain data). */
  names: Record<string, string>
}) {
  const [events, setEvents] = useState(seed)
  const [cursor, setCursor] = useState(seedCursor)
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0) // only the newest request may answer: a slow one cannot overwrite a newer filter
  const [seenTypes, setSeenTypes] = useState(() => uniq(seed.map((e) => e.recordType)))
  const read = (next: AuditFilters, after?: string) => {
    const ticket = ++latest.current
    setBusy(true)
    setError(null)
    loadAudit(apiBrowser, next, timezone, nameFrom(names), after)
      .then((p) => {
        if (ticket !== latest.current) return
        setEvents((cur) => (after ? [...cur, ...p.events] : p.events))
        setCursor(p.nextCursor)
        setSeenTypes((cur) => uniq([...cur, ...p.events.map((e) => e.recordType)]))
      })
      .catch((e: unknown) => ticket === latest.current && setError(userMessage(e).text))
      .finally(() => ticket === latest.current && setBusy(false))
  }
  const set = <K extends keyof AuditFilters>(k: K, v: AuditFilters[K]) => {
    const next = { ...filters, [k]: v }
    setFilters(next)
    setPage(1)
    setOpen(null)
    // everything but the text search is the API's filter: re-read page one for it
    if (k !== "q") read(next)
  }

  // the options do not depend on the rows on screen (a filter must not remove its own alternatives): people the caller can see, the catalogue's actions, the record types seen so far
  const actors = useMemo(
    () => [{ value: "all", label: "All actors" }, ...Object.entries(names).sort((a, b) => a[1].localeCompare(b[1])).map(([id, n]) => ({ value: id, label: n })), { value: SYSTEM_ACTOR, label: "System" }],
    [names],
  )
  const actions = useMemo(
    () => [{ value: "all", label: "All actions" }, ...Object.entries(AUDIT_ACTIONS).map(([a, i]) => ({ value: a, label: i.label })).sort((a, b) => a.label.localeCompare(b.label))],
    [],
  )
  const types = useMemo(() => [{ value: "all", label: "All records" }, ...seenTypes.map((t) => ({ value: t, label: t }))], [seenTypes])

  const rows = useMemo(() => filterEvents(events, filters), [events, filters])
  const pg = paginate(rows, page, AUDIT_PAGE_SIZE)
  const flagged = events.filter((e) => e.sensitive).length

  return (
    <>
      <PageHead
        title="Audit Log"
        subtitle="Who did what, when and from where"
        actions={
          <a className="btn btn-outline" href={exportUrl(filters, timezone)} download title="The export uses every filter except the search">
            Export CSV
          </a>
        }
      />
      <div className="card au-card">
        <p className="au-note">
          <Icon name="lock" />
          <span>
            Audit records can&apos;t be edited or deleted. {flagged} sensitive actions are flagged. Export CSV uses the same filters, not the search.{cursor ? ` Showing the latest ${events.length.toLocaleString("en")}: load older entries or export the CSV for all.` : ""}
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
            {cursor && (
              <div className="au-more">
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => read(filters, cursor)}>Load older</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
