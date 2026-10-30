"use client"

import { Fragment, useMemo, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"

import { DataPagination, PagedBody } from "@/components/data-pagination"
import { DatePicker } from "@/components/date-picker"
import { CopyId } from "@/components/copy-id"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { When } from "@/components/when"
import { downloadCsv, toCsv } from "@/lib/csv"
import { paginate } from "@/lib/paginate"
import { AUDIT_CSV_COLUMNS, auditChanges, auditCsvRows, auditOptions, sortAudit, type AuditLogData } from "../audit"
import { AUDIT_LOG_PAGE_SIZE, PAGE_HEADS } from "../constants"
import { dateY, filterAudit, type AuditFilters } from "../logic"
import { foldAudit } from "../patches"
import { STAFF_ROLE_LABEL } from "../permissions"
import { auditStore, useOutbox } from "../store"

const ALL = "all"
type Filters = { actor: string; action: string; tenant: string; from: string; to: string }
const EMPTY: Filters = { actor: ALL, action: ALL, tenant: ALL, from: "", to: "" }
const noStore = () => undefined

// The platform audit log (Task 9, FR-SAAS-10). Read only and immutable: there is no edit or delete anywhere, only
// filters, row details and CSV export. Lines written this session (other console pages) arrive through the store patch
// contract (store.ts): the full log if a full page loaded it, else the server's, with the outbox folded in.
export function AuditLogView({ data, today, tzLabel }: { data: AuditLogData; today: string; tzLabel: string }) {
  const full = useSyncExternalStore(auditStore.subscribe, auditStore.get, noStore)
  const outbox = useOutbox()
  const all = useMemo(() => sortAudit(foldAudit(full ?? data.entries, outbox)), [full, data.entries, outbox])
  const names = useMemo(() => new Map(data.tenants.map((t) => [t.id, t.name])), [data.tenants])

  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setPage(1)
    setOpen(null)
  }

  const { actors, actions } = useMemo(() => auditOptions(all), [all])
  const rows = useMemo(() => {
    const f: AuditFilters = {
      ...(filters.tenant !== ALL ? { tenantId: filters.tenant, name: names.get(filters.tenant) } : {}),
      ...(filters.actor !== ALL ? { actor: filters.actor } : {}),
      ...(filters.action !== ALL ? { action: filters.action } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
    }
    return filterAudit(all, f)
  }, [all, filters, names])
  const pg = paginate(rows, page, AUDIT_LOG_PAGE_SIZE)
  const filtered = JSON.stringify(filters) !== JSON.stringify(EMPTY)

  function exportCsv() {
    const file = `platform-audit-${today.slice(0, 10)}.csv`
    downloadCsv(toCsv(auditCsvRows(rows, names), AUDIT_CSV_COLUMNS), file)
    toast.success("CSV exported", { description: `${rows.length} line${rows.length === 1 ? "" : "s"} · ${file}` })
  }

  const { title, subtitle } = PAGE_HEADS.audit
  return (
    <>
      <PageHead
        title={title}
        subtitle={subtitle}
        actions={
          <button type="button" className="btn btn-outline" onClick={exportCsv} disabled={rows.length === 0}>
            <Icon name="download" />
            Export CSV
          </button>
        }
      />
      <div className="card pf-card">
        <p className="pf-aud-note">
          <Icon name="lock" />
          <span>Audit lines can&apos;t be edited or deleted. Sensitive actions record the staff role, the change and the reason.</span>
        </p>
        <FilterBar>
          <FilterSelect label="Actor" value={filters.actor} options={[{ value: ALL, label: "All actors" }, ...actors.map((a) => ({ value: a, label: a }))]} onChange={(v) => set("actor", v)} />
          <FilterSelect label="Action" value={filters.action} options={[{ value: ALL, label: "All actions" }, ...actions.map((a) => ({ value: a, label: a }))]} onChange={(v) => set("action", v)} />
          <FilterSelect label="Tenant" value={filters.tenant} options={[{ value: ALL, label: "All tenants" }, ...data.tenants.map((t) => ({ value: t.id, label: t.name }))]} onChange={(v) => set("tenant", v)} />
          <span className="pf-aud-range">
            <DatePicker value={filters.from} onChange={(v) => set("from", v)} today={today} label="From date" placeholder="From" />
            <DatePicker value={filters.to} onChange={(v) => set("to", v)} today={today} min={filters.from || undefined} label="To date" placeholder="To" />
          </span>
          {filtered && (
            <button type="button" className="pf-aud-clear" onClick={() => { setFilters(EMPTY); setPage(1); setOpen(null) }}>Clear filters</button>
          )}
        </FilterBar>
        {rows.length === 0 ? (
          <EmptyState icon="shield" title="No audit lines match" text={filtered ? "Try a different actor, action, tenant or date range." : "Platform actions appear here as staff take them."} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="rtable pf-table pf-auditlog">
                <thead>
                  <tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th><span className="sr-only">Details</span></th></tr>
                </thead>
                <PagedBody page={pg.page}>
                  {pg.rows.map((e) => {
                    const isOpen = open === e.id
                    const changes = auditChanges(e)
                    const panel = `pf-aud-${e.id}`
                    return (
                      <Fragment key={e.id}>
                        <tr data-open={isOpen || undefined}>
                          <td data-label="When" className="num">
                            <div className="pf-dr-stack">
                              <div className="tt"><time dateTime={e.at}>{dateY(e.at)}</time></div>
                              <div className="tm"><When iso={e.at} today={today} tzLabel={tzLabel} mode="time" /></div>
                            </div>
                          </td>
                          <td data-label="Actor">
                            <div className="pf-dr-stack">
                              <div className="tt">{e.actor}</div>
                              <div className="tm">{e.staffRole ? STAFF_ROLE_LABEL[e.staffRole] : "Tenant or system"}</div>
                            </div>
                          </td>
                          <td data-label="Action">
                            <span className="pf-aud-act">{e.action}</span>
                            {e.reason && <span className="pf-aud-flag">Sensitive</span>}
                          </td>
                          <td data-label="Target" className="pf-aud-target">
                            <div className="pf-dr-stack">
                              <div className="tt">{e.target}</div>
                              <div className="tm">{e.detail}</div>
                            </div>
                          </td>
                          <td className="pf-aud-tog">
                            <button type="button" className="pf-aud-toggle" aria-expanded={isOpen} aria-controls={isOpen ? panel : undefined} onClick={() => setOpen(isOpen ? null : e.id)}>
                              {isOpen ? "Hide" : "Details"}
                              <span className="sr-only"> for {e.id}</span>
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="pf-aud-meta-row" id={panel}>
                            <td colSpan={5}>
                              <dl className="pf-aud-meta">
                                <div><dt>Entry</dt><dd className="num">{e.id} <CopyId value={e.id} what="audit entry ID" className="od-copy-inline" /></dd></div>
                                <div><dt>Recorded</dt><dd className="num">{e.at.replace("T", " ").slice(0, 16)} {tzLabel}</dd></div>
                                {e.tenantId && <div><dt>Tenant</dt><dd>{names.get(e.tenantId) ?? e.tenantId}</dd></div>}
                                <div className="pf-aud-wide">
                                  <dt>Before → after</dt>
                                  <dd>
                                    {changes.length ? (
                                      <ul className="pf-aud-diff num">
                                        {changes.map((c) => <li key={c.key}><b>{c.key}</b> {c.before} → {c.after}</li>)}
                                      </ul>
                                    ) : "No field change recorded on this line"}
                                  </dd>
                                </div>
                                <div className="pf-aud-wide"><dt>Reason</dt><dd>{e.reason ?? "None recorded (not a sensitive action)"}</dd></div>
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
            <DataPagination page={pg.page} pageCount={pg.pageCount} total={pg.total} from={pg.from} to={pg.to} label="Audit log pages" onPageChange={(p) => { setPage(p); setOpen(null) }} />
          </>
        )}
      </div>
    </>
  )
}
