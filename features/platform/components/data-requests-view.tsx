"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { motion } from "motion/react"
import { toast } from "sonner"

import { DataPagination, PagedBody } from "@/components/data-pagination"
import { CopyId } from "@/components/copy-id"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSeg, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { SortHeader } from "@/components/sort-header"
import { StatusPill } from "@/components/status-pill"
import { downloadCsv, toCsv } from "@/lib/csv"
import { layoutTransition } from "@/lib/motion"
import { paginate } from "@/lib/paginate"
import { DATA_REQUESTS_PAGE_SIZE, PAGE_HEADS } from "../constants"
import {
  DEFAULT_DATA_SORT, DR_STATUS, DR_VIEWS, KIND_LABEL, SUBJECT_LABEL, completeBlock, dataViewCounts, dueLabel, filterRequests, sortRequests, transition, transitionAudit,
  type DataRequestsData, type DataSort, type DataSortKey, type DataView,
} from "../data-requests"
import { auditEntry, dateY, nowIso, sensitiveEntry } from "../logic"
import { applyPatches, mergePatch } from "../patches"
import { auditOutbox, dataRequestPatchStore, dataRequestsStore, tenantsStore, useDataRequestOutbox, useDataRequestPatches, usePatches, knownAudit } from "../store"
import type { AuditEntry, DataRequest, DataRequestStatus } from "../types"
import { tenantPath } from "../tenant-360"
import { ResolveDialog } from "./resolve-dialog"
import type { Operator } from "./tenants-view"

const SORTS: { value: string; label: string }[] = [
  { value: "due:asc", label: "Due soonest" },
  { value: "due:desc", label: "Due latest" },
  { value: "requested:desc", label: "Newest" },
  { value: "requested:asc", label: "Oldest" },
  { value: "tenant:asc", label: "Tenant A–Z" },
  { value: "type:asc", label: "Type" },
  { value: "status:asc", label: "Status" },
]

const known = knownAudit

// `q`: a search from the URL (`?q=`), e.g. a request id picked in the ⌘K palette.
type Props = { data: DataRequestsData; view: DataView; q?: string; today: string; operator: Operator }
type Pending = { request: DataRequest; mode: "complete" | "reject" }

export function DataRequestsView({ data, view, q = "", today, operator }: Props) {
  // Patch model (store.ts): the full requests store (if a full page loaded it) over the server rows, new requests filed
  // from a tenant 360 (the outbox), then this page's own patches. Same for a tenant's deletion date.
  const full = useSyncExternalStore(dataRequestsStore.subscribe, dataRequestsStore.get, () => undefined)
  const fullTenants = useSyncExternalStore(tenantsStore.subscribe, tenantsStore.get, () => undefined)
  const outbox = useDataRequestOutbox()
  const patches = useDataRequestPatches()
  const tenantPatches = usePatches()

  const all = useMemo(() => {
    const base = full ?? data.requests
    const ids = new Set(base.map((r) => r.id))
    const fresh = outbox.filter((r) => !ids.has(r.id))
    return applyPatches([...fresh, ...base], patches)
  }, [data.requests, full, outbox, patches])

  const names = useMemo(() => new Map(data.tenants.map((t) => [t.id, t.name])), [data.tenants])
  const deletionAt = (tenantId: string): string | undefined => {
    const p = tenantPatches[tenantId]
    if (p && "deletionAt" in p) return p.deletionAt
    const f = fullTenants?.find((t) => t.id === tenantId)
    return f ? f.deletionAt : data.tenants.find((t) => t.id === tenantId)?.deletionAt
  }

  const [filters, setFilters] = useState({ view, q })
  const [sort, setSort] = useState<DataSort>(DEFAULT_DATA_SORT)
  const [sorting, setSorting] = useState(false)
  const [page, setPage] = useState(1)
  const [pending, setPending] = useState<Pending | null>(null)
  // A soft navigation to another `?view=` / `?q=` (a link, the ⌘K palette) brings new props: follow them.
  const [seen, setSeen] = useState({ view, q })
  if (seen.view !== view || seen.q !== q) {
    setSeen({ view, q })
    setFilters({ view, q })
    setPage(1)
  }

  const counts = useMemo(() => dataViewCounts(all, today), [all, today])
  const rows = useMemo(() => sortRequests(filterRequests(all, filters, today, names), sort, names), [all, filters, today, names, sort])
  const paged = paginate(rows, page, DATA_REQUESTS_PAGE_SIZE)
  const filtered = filters.q !== ""

  function setView(v: DataView) {
    setFilters((f) => ({ ...f, view: v }))
    setSorting(false)
    setPage(1)
    const url = new URL(window.location.href)
    if (v === "open") url.searchParams.delete("view")
    else url.searchParams.set("view", v)
    window.history.replaceState(null, "", `${url.pathname}${url.search}`)
  }
  function changeSort(s: DataSort) {
    setSort(s)
    setSorting(true)
    setPage(1)
  }

  // One write path (store.ts patch contract): the request patch plus an audit line in the outbox. Completing and rejecting
  // are D7 actions (required note or reason, before/after); starting records the same change without a reason.
  function commit(r: DataRequest, to: DataRequestStatus, text?: string) {
    const at = nowIso(today)
    let next: DataRequest
    try {
      next = transition(r, to, { at, by: operator.name, text, deletionAt: deletionAt(r.tenantId) })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That change isn't allowed")
      return
    }
    dataRequestPatchStore.set((p) => ({
      ...p,
      [r.id]: mergePatch(p[r.id], { status: next.status, resolution: next.resolution, closedAt: next.closedAt, closedBy: next.closedBy }),
    }))
    const tenantName = names.get(r.tenantId) ?? r.tenantId
    // What the line says lives in data-requests.ts (transitionAudit); here it gets the actor, time and id.
    const { sensitive, reason, ...line } = transitionAudit(r, next, to, text)
    const entry: AuditEntry = sensitive
      ? sensitiveEntry(known(), { at, actor: operator.name, staffRole: operator.role, tenantId: r.tenantId, target: tenantName, ...line, reason: reason ?? "" })
      : { ...auditEntry(known(), at, operator.name, line.action, tenantName, line.detail), tenantId: r.tenantId, staffRole: operator.role, before: line.before, after: line.after }
    auditOutbox.set((list) => [entry, ...list])
    toast.success(to === "in_progress" ? `${r.id} started` : to === "completed" ? `${r.id} completed` : `${r.id} rejected`)
  }

  function exportCsv() {
    const csv = toCsv(
      rows.map((r) => ({
        id: r.id, type: KIND_LABEL[r.kind], subject: SUBJECT_LABEL[r.subject], requestedBy: r.requestedBy, tenant: names.get(r.tenantId) ?? r.tenantId, tenantId: r.tenantId,
        requested: r.requestedAt.slice(0, 10), due: r.dueAt.slice(0, 10), status: DR_STATUS[r.status].label, closed: r.closedAt?.slice(0, 10) ?? "",
      })),
      [
        { key: "id", label: "Request ID" }, { key: "type", label: "Type" }, { key: "subject", label: "Subject" }, { key: "requestedBy", label: "Requested by" },
        { key: "tenant", label: "Tenant" }, { key: "tenantId", label: "Tenant ID" }, { key: "requested", label: "Requested" }, { key: "due", label: "Due" },
        { key: "status", label: "Status" }, { key: "closed", label: "Closed" },
      ],
    )
    const file = `data-requests-${filters.view}-${today.slice(0, 10)}.csv`
    downloadCsv(csv, file)
    toast.success("CSV exported", { description: file })
  }

  const { title, subtitle } = PAGE_HEADS["data-requests"]
  const head = (label: string, key: DataSortKey, first: "asc" | "desc" = "asc") => <SortHeader label={label} sortKey={key} sort={sort} onSort={changeSort} first={first} />
  const target = pending ? pending.request : null

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
        <FilterBar>
          <FilterSeg
            label="Saved views"
            value={filters.view}
            onChange={setView}
            options={DR_VIEWS.map((v) => ({ value: v.value, label: <>{v.label} <span className="num pf-count">{counts[v.value]}</span></> }))}
          />
        </FilterBar>
        <FilterBar>
          <FilterSearch value={filters.q} onChange={(q) => { setFilters((f) => ({ ...f, q })); setSorting(false); setPage(1) }} placeholder="Search request, requester or tenant" />
          <span className="pf-sort-m">
            <FilterSelect
              label="Sort by"
              value={SORTS.some((s) => s.value === `${sort.key}:${sort.dir}`) ? `${sort.key}:${sort.dir}` : "due:asc"}
              options={SORTS}
              onChange={(v) => {
                const [key, dir] = v.split(":") as [DataSortKey, DataSort["dir"]]
                changeSort({ key, dir })
              }}
            />
          </span>
        </FilterBar>
        {rows.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className="rtable pf-table pf-dreq">
                <thead>
                  <tr>
                    {head("Type", "type")}
                    <th>Subject</th>
                    {head("Tenant", "tenant")}
                    {head("Requested", "requested", "desc")}
                    {head("Due", "due")}
                    {head("Status", "status")}
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <PagedBody page={paged.page} reorder>
                  {paged.rows.map((r) => {
                    const left = dueLabel(r, today)
                    const block = r.status === "in_progress" ? completeBlock(r, deletionAt(r.tenantId), today) : null
                    const hint = `pf-dr-hint-${r.id}`
                    return (
                      <motion.tr key={r.id} layout={sorting ? "position" : false} transition={layoutTransition}>
                        <td data-label="Type">
                          <div className="tt">{KIND_LABEL[r.kind]}</div>
                          <div className="tm num">{r.id} <CopyId value={r.id} what="request ID" className="od-copy-inline" /></div>
                        </td>
                        <td data-label="Subject" className="pf-dr-subject">
                          <div className="pf-dr-stack">
                            <div className="tt">{r.requestedBy}</div>
                            <div className="tm">{SUBJECT_LABEL[r.subject]}</div>
                            {r.note && <div className="tm pf-dr-note">{r.note}</div>}
                          </div>
                        </td>
                        <td data-label="Tenant" className="pf-inv-tenant"><Link href={tenantPath(r.tenantId)} className="pf-link">{names.get(r.tenantId) ?? r.tenantId}</Link></td>
                        <td data-label="Requested" className="num"><time dateTime={r.requestedAt}>{dateY(r.requestedAt)}</time></td>
                        <td data-label="Due" className="num">
                          <div className="pf-dr-stack">
                            <time dateTime={r.dueAt}>{dateY(r.dueAt)}</time>
                            {left && <div className={left.urgent ? "pf-dr-left pf-dr-urgent" : "pf-dr-left"}>{left.text}</div>}
                          </div>
                        </td>
                        <td data-label="Status">
                          <div className="pf-dr-stack">
                            <StatusPill status={DR_STATUS[r.status]} />
                            {r.resolution && <div className="tm pf-dr-note">{r.resolution}</div>}
                          </div>
                        </td>
                        <td className="pf-acts pf-dr-acts">
                          {r.status === "received" && (
                            <button type="button" className="btn btn-primary pf-act" onClick={() => commit(r, "in_progress")}>Start</button>
                          )}
                          {r.status === "in_progress" && (
                            <button type="button" className="btn btn-primary pf-act" disabled={block !== null} aria-describedby={block ? hint : undefined} onClick={() => setPending({ request: r, mode: "complete" })}>Complete</button>
                          )}
                          {(r.status === "received" || r.status === "in_progress") && (
                            <button type="button" className="btn btn-outline pf-act" onClick={() => setPending({ request: r, mode: "reject" })}>Reject</button>
                          )}
                          {block && <p id={hint} className="pf-dr-block">{block}</p>}
                        </td>
                      </motion.tr>
                    )
                  })}
                </PagedBody>
              </table>
            </div>
            <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Data request pages" onPageChange={(p) => { setSorting(false); setPage(p) }} />
          </>
        ) : (
          <EmptyState
            icon="download"
            title="No requests match"
            text={filtered ? "Try a different search or view." : filters.view === "open" ? "Nothing is waiting. Every request is closed." : "No requests in this view."}
            action={filtered ? <button type="button" className="btn btn-outline" onClick={() => setFilters((f) => ({ ...f, q: "" }))}>Clear search</button> : undefined}
          />
        )}
      </div>

      <ResolveDialog
        key={pending ? `${pending.request.id}:${pending.mode}` : "none"}
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.mode === "reject" ? `Reject ${target?.id}?` : `Complete ${target?.id}?`}
        text={
          pending?.mode === "reject"
            ? "The request is closed as rejected. The reason is recorded in the audit trail."
            : "Closes the request as done. This is recorded in the audit trail."
        }
        label={pending?.mode === "reject" ? "Reason" : "Note (for example: export ready)"}
        confirmLabel={pending?.mode === "reject" ? "Reject request" : "Complete request"}
        destructive={pending?.mode === "reject"}
        onConfirm={(text) => pending && commit(pending.request, pending.mode === "reject" ? "rejected" : "completed", text)}
      />
    </>
  )
}
