"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { DataPagination, PagedBody } from "@/components/data-pagination"
import { DatePicker } from "@/components/date-picker"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { auditOutbox } from "@/lib/audit-outbox"
import { paginate } from "@/lib/paginate"
import { AUDIT_PAGE_SIZE, EMPTY_FILTERS, exportEvent, filterEvents, mergeOutbox, toCsv } from "../filters"
import { auditStore } from "../store"
import { ACTION } from "../types"
import type { AuditAction, AuditEvent, AuditFilters } from "../types"

const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b))

export function AuditView({
  events: seed,
  today,
  tzLabel,
  user,
  scopeKey,
}: {
  events: AuditEvent[]
  today: string
  tzLabel: string
  /** Who is signed in: recorded as the actor of an export. */
  user: { name: string; role: string }
  /** Tenant id: the store re-seeds when the company changes, so one tenant's events never show in another (FR-SAAS-02). */
  scopeKey: string
}) {
  const [events, setEvents] = auditStore.useStore(seed, scopeKey)
  // Events recorded on other screens this session (FR-M0-13), e.g. a task purged from the archive. Idempotent.
  useEffect(() => {
    setEvents((all) => mergeOutbox(all, auditOutbox.list(scopeKey)))
  }, [scopeKey, setEvents])
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const set = <K extends keyof AuditFilters>(k: K, v: AuditFilters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
    setOpen(null)
  }

  const actors = useMemo(() => [{ value: "all", label: "All actors" }, ...uniq(events.map((e) => e.actor)).map((a) => ({ value: a, label: a }))], [events])
  const actions = useMemo(
    () => [
      { value: "all", label: "All actions" },
      ...(Object.keys(ACTION) as AuditAction[]).filter((a) => events.some((e) => e.action === a)).map((a) => ({ value: a, label: ACTION[a].label })),
    ],
    [events],
  )
  const types = useMemo(() => [{ value: "all", label: "All records" }, ...uniq(events.map((e) => e.recordType)).map((t) => ({ value: t, label: t }))], [events])

  const rows = useMemo(() => filterEvents(events, filters), [events, filters])
  const pg = paginate(rows, page, AUDIT_PAGE_SIZE)
  const failed = events.filter((e) => e.action === "failed_sign_in").length

  function exportCsv() {
    const filename = `audit-log-${today.slice(0, 10)}.csv`
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }))
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    const at = `${today.slice(0, 10)}T${today.slice(11, 16)}:00`
    setEvents((all) => [exportEvent(all, { actor: user.name, role: user.role }, at, rows.length, filename), ...all])
    toast.success("Export logged")
  }

  return (
    <>
      <PageHead
        title="Audit Log"
        subtitle="Who did what, when and from where"
        actions={
          <button type="button" className="btn btn-outline" onClick={exportCsv}>
            Export CSV
          </button>
        }
      />
      <div className="card au-card">
        <p className="au-note">
          <Icon name="lock" />
          <span>
            Audit records can&apos;t be edited or deleted. {failed} failed sign-in attempts and other sensitive actions are flagged.
          </span>
        </p>
        <FilterBar>
          <FilterSearch value={filters.q} onChange={(v) => set("q", v)} placeholder="Search events" />
          <FilterSelect label="Actor" value={filters.actor} options={actors} onChange={(v) => set("actor", v)} />
          <FilterSelect label="Action" value={filters.action} options={actions} onChange={(v) => set("action", v)} />
          <FilterSelect label="Record type" value={filters.recordType} options={types} onChange={(v) => set("recordType", v)} />
          <DatePicker value={filters.from} onChange={(v) => set("from", v)} today={today} label="From date" placeholder="From" />
          <DatePicker value={filters.to} onChange={(v) => set("to", v)} today={today} min={filters.from || undefined} label="To date" placeholder="To" />
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState icon="history" title="No events match" text="Try a different actor, action or date range." />
        ) : (
          <>
            <div className="table-wrap">
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
                            <div className="tm">{e.actorRole}</div>
                          </td>
                          <td data-label="Action">
                            <StatusPill status={ACTION[e.action]} />
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
                                <div><dt>IP address</dt><dd className="num">{e.ip}</dd></div>
                                <div><dt>Device</dt><dd>{e.device}</dd></div>
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
