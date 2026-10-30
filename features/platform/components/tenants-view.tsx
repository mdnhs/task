"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSeg, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { PageHead } from "@/components/page-head"
import { downloadCsv, toCsv } from "@/lib/csv"
import { copyText } from "@/lib/clipboard"
import { paginate } from "@/lib/paginate"
import { TENANTS_PAGE_SIZE } from "../constants"
import { DEFAULT_SORT, EMPTY_FILTERS, TENANT_VIEWS, filterTenants, nowIso, sensitiveEntry, sortTenants, viewCounts } from "../logic"
import { applyPatches, mergePatch, type TenantPatch } from "../patches"
import { auditOutbox, auditStore, tenantPatchStore, tenantsStore, useOutbox, usePatches } from "../store"
import { liveRows, type TenantListRow, type TenantsData } from "../tenants"
import { TENANT_STATUS } from "../types"
import type { StaffRole, TenantSort, TenantStatus, TenantView } from "../types"
import { tenantPath } from "../tenant-360"
import { SlugConfirmDialog } from "./slug-confirm-dialog"
import { HEALTH_BAND, TenantTable } from "./tenant-table"

const STATUS_OPTIONS: { value: "all" | TenantStatus; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...(Object.keys(TENANT_STATUS) as TenantStatus[]).map((s) => ({ value: s, label: TENANT_STATUS[s].label })),
]

// Phones hide the table head (rows stack into cards), so the sort is a select there.
const SORTS: { value: string; label: string; billing?: boolean }[] = [
  { value: "name:asc", label: "Name A–Z" },
  { value: "name:desc", label: "Name Z–A" },
  { value: "mrr:desc", label: "MRR, highest", billing: true },
  { value: "health:asc", label: "Health, lowest" },
  { value: "users:desc", label: "Most users" },
  { value: "storage:desc", label: "Most storage" },
  { value: "created:desc", label: "Newest" },
  { value: "created:asc", label: "Oldest" },
  { value: "plan:desc", label: "Plan, largest" },
  { value: "status:asc", label: "Status" },
]

export type Operator = { name: string; role: StaffRole }

export function TenantsView({ data, view, today, operator }: { data: TenantsData; view: TenantView; today: string; operator: Operator }) {
  const router = useRouter()
  // Patch model (store.ts): the rows are the server's slim rows, overlaid by the full tenants store when a full page
  // already loaded it (its edits), then by this list's own patches. The list never writes the full stores.
  const full = useSyncExternalStore(tenantsStore.subscribe, tenantsStore.get, () => undefined)
  const patches = usePatches()
  const outbox = useOutbox()
  const tenants = useMemo(() => {
    const byId = new Map((full ?? []).map((t) => [t.id, t]))
    const base = data.tenants.map((t) => {
      const f = byId.get(t.id)
      return f ? { ...t, status: f.status, suspendedAt: f.suspendedAt, suspendReason: f.suspendReason, statusBeforeSuspend: f.statusBeforeSuspend } : t
    })
    return applyPatches(base, patches)
  }, [data.tenants, full, patches])

  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, view })
  const [sort, setSort] = useState<TenantSort>(DEFAULT_SORT)
  const [sorting, setSorting] = useState(false)
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<TenantListRow | null>(null)
  const [open, setOpen] = useState(false)
  // A soft navigation to another `?view=` while on the page (a link, the search) brings a new prop: follow it.
  const [seenView, setSeenView] = useState(view)
  if (seenView !== view) {
    setSeenView(view)
    setFilters((f) => ({ ...f, view }))
    setPage(1)
  }

  const all = useMemo(() => liveRows(tenants, data.derived), [tenants, data.derived])
  const counts = useMemo(() => viewCounts(all), [all])
  const rows = useMemo(() => sortTenants(filterTenants(all, filters), sort), [all, filters, sort])
  const paged = paginate(rows, page, TENANTS_PAGE_SIZE)
  const filtered = filters.q !== "" || filters.status !== "all" || filters.plan !== "all" || filters.view !== "all"
  const showMrr = data.can.amounts

  const set = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) => {
    setFilters((f) => ({ ...f, [k]: v }))
    setSorting(false)
    setPage(1)
  }

  function setView(v: TenantView) {
    set("view", v)
    // A linkable view (`?view=`); the History API keeps Next's router in step without a server round trip.
    const url = new URL(window.location.href)
    if (v === "all") url.searchParams.delete("view")
    else url.searchParams.set("view", v)
    window.history.replaceState(null, "", `${url.pathname}${url.search}`)
  }

  function changeSort(s: TenantSort) {
    setSort(s)
    setSorting(true)
    setPage(1)
  }

  async function copy(t: TenantListRow) {
    if (await copyText(t.id)) toast.success(`Copied ${t.id}`)
    else toast.error("Could not copy", { description: `Select ${t.id} and copy it instead.` })
  }

  function exportCsv() {
    const columns = [
      { key: "id", label: "ID" },
      { key: "name", label: "Name" },
      { key: "slug", label: "Slug" },
      { key: "subdomain", label: "Subdomain" },
      { key: "plan", label: "Plan" },
      { key: "status", label: "Status" },
      { key: "health", label: "Health" },
      { key: "score", label: "Health score" },
      { key: "users", label: "Users" },
      { key: "limit", label: "User limit" },
      { key: "storage", label: "Storage (GB)" },
      ...(showMrr ? [{ key: "mrr", label: "MRR" }, { key: "currency", label: "Currency" }] : []),
      { key: "created", label: "Created" },
    ]
    const csv = toCsv(
      rows.map((t) => ({
        id: t.id, name: t.name, slug: t.slug, subdomain: t.subdomain, plan: t.planName, status: TENANT_STATUS[t.status].label,
        health: HEALTH_BAND[t.health.band].label, score: t.health.score, users: t.users, limit: t.userLimit, storage: t.storageGb,
        mrr: t.mrr ?? 0, currency: t.currency, created: t.createdAt.slice(0, 10),
      })),
      columns,
    )
    const file = `tenants-${filters.view === "all" ? "all" : filters.view.replace("_", "-")}-${today.slice(0, 10)}.csv`
    downloadCsv(csv, file)
    toast.success("CSV exported", { description: file })
  }

  function toggle(reason: string) {
    const row = target
    const t = row && tenants.find((x) => x.id === row.id)
    if (!t) return
    const at = nowIso(today)
    const reactivating = t.status === "suspended"
    // Reactivate returns to the status the suspend interrupted (Review Focus 5); a seed suspension to what the server derived.
    const patch: TenantPatch = reactivating
      ? { status: t.statusBeforeSuspend ?? data.derived[t.id]?.reactivatesAs ?? "active", suspendedAt: undefined, suspendReason: undefined, statusBeforeSuspend: undefined }
      : { status: "suspended", suspendedAt: at, suspendReason: reason, statusBeforeSuspend: t.status }
    const next = { status: patch.status }
    tenantPatchStore.set((all) => ({ ...all, [t.id]: mergePatch(all[t.id], patch) }))
    // Ids are numbered against the full log when a full page folds the outbox in; here against what this page knows.
    const known = [...(auditStore.get() ?? []), ...outbox]
    auditOutbox.set((list) => [
      sensitiveEntry(known, {
        at, actor: operator.name, staffRole: operator.role, tenantId: t.id, action: reactivating ? "tenant.reactivated" : "tenant.suspended", target: t.name,
        detail: `${reactivating ? "Reactivated" : "Suspended"}: ${reason}`, before: { status: t.status }, after: { status: next.status }, reason,
      }),
      ...list,
    ])
    toast.success(`${t.name} ${reactivating ? "reactivated" : "suspended"}`)
  }

  const suspended = target?.status === "suspended"
  const sortOptions = SORTS.filter((s) => showMrr || !s.billing)

  return (
    <>
      <PageHead
        title="Tenants"
        subtitle={`${all.length} companies on the platform`}
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
            options={TENANT_VIEWS.map((v) => ({ value: v.value, label: <>{v.label} <span className="num pf-count">{counts[v.value]}</span></> }))}
          />
        </FilterBar>
        <FilterBar>
          <FilterSearch value={filters.q} onChange={(v) => set("q", v)} placeholder="Search name, slug or ID" />
          <FilterSelect label="Plan" value={filters.plan} options={[{ value: "all", label: "All plans" }, ...data.plans.map((p) => ({ value: p.id, label: p.name }))]} onChange={(v) => set("plan", v)} />
          <FilterSelect label="Status" value={filters.status} options={STATUS_OPTIONS} onChange={(v) => set("status", v)} />
          <span className="pf-sort-m">
            <FilterSelect
              label="Sort by"
              value={sortOptions.some((s) => s.value === `${sort.key}:${sort.dir}`) ? `${sort.key}:${sort.dir}` : "name:asc"}
              options={sortOptions}
              onChange={(v) => {
                const [key, dir] = v.split(":") as [TenantSort["key"], TenantSort["dir"]]
                changeSort({ key, dir })
              }}
            />
          </span>
        </FilterBar>
        {rows.length > 0 ? (
          <>
            <TenantTable
              rows={paged.rows}
              page={paged.page}
              sort={sort}
              onSort={changeSort}
              sorting={sorting}
              showMrr={showMrr}
              actions={{
                canSupport: data.can.support,
                canSuspend: data.can.suspend,
                onOpen: (t) => router.push(tenantPath(t.id)),
                onCopy: copy,
                onSupport: (t) => router.push(`/platform/support?request=${encodeURIComponent(t.id)}`),
                onToggle: (t) => {
                  setTarget(t)
                  setOpen(true)
                },
              }}
            />
            <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Tenants pages" onPageChange={(p) => { setSorting(false); setPage(p) }} />
          </>
        ) : (
          <EmptyState
            icon="folder"
            title="No tenants match"
            text={filtered ? "Try a different search, view or filter." : "No companies have signed up yet."}
            action={
              filtered ? (
                <button type="button" className="btn btn-outline" onClick={() => { setView("all"); setFilters(EMPTY_FILTERS); setPage(1) }}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        )}
      </div>
      {data.can.suspend && target && (
        <SlugConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={suspended ? `Reactivate ${target.name}?` : `Suspend ${target.name}?`}
          text={
            suspended
              ? `${target.name} gets full write access again. The reason is recorded in the platform audit trail.`
              : `Everyone at ${target.name} keeps read-only access until you reactivate it. The reason is recorded in the platform audit trail.`
          }
          reason
          slug={suspended ? undefined : target.slug}
          confirmLabel={suspended ? "Reactivate" : "Suspend"}
          destructive={!suspended}
          onConfirm={toggle}
        />
      )}
    </>
  )
}
