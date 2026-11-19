"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { CopyId } from "@/components/copy-id"
import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSearch, FilterSeg, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { downloadCsv, toCsv } from "@/lib/csv"
import type { LiveTenantList, LiveTenantRow } from "../adapters"
import { HEALTH_PILL, bytes, dateUtc, minorMoney } from "../format"
import { DEFAULT_LIVE_SORT, LIVE_VIEWS, sortRows, viewCounts, viewRows, type LiveSort, type LiveSortKey, type LiveView } from "../live-views"
import { tenantPath } from "../tenant-360"
import { TENANT_STATUS } from "../types"
import { SlugConfirmDialog } from "./slug-confirm-dialog"
import { usePlatform } from "./use-platform"

const SORTS: { value: string; label: string }[] = [
  { value: "created:desc", label: "Newest" }, { value: "created:asc", label: "Oldest" }, { value: "name:asc", label: "Name A–Z" }, { value: "name:desc", label: "Name Z–A" },
  { value: "seats:desc", label: "Most seats" }, { value: "plan:asc", label: "Plan" }, { value: "status:asc", label: "Status" },
]

/** `revenue`: the operator may read billing figures (billing.read): the MRR column shows only then. */
export type TenantsCan = { suspend: boolean; support: boolean; revenue?: boolean }

/** Seat bar state: near the plan's limit from 90%, over it above 100%. */
const seatState = (used: number, limit: number | null) => (limit === null || limit <= 0 ? undefined : used > limit ? "over" : used / limit >= 0.9 ? "near" : undefined)

/**
 * The tenants list on the API (B6 T6.8). The server pages (`?page=`) and the API filters by name; the saved views that need a subscription status, and the sort, work on the loaded
 * page (the list says so when there is more than one page). Suspend and reactivate are one call each with the typed reason.
 */
export function LiveTenants({ data, view: initial, q, can }: { data: LiveTenantList; view: LiveView; q: string; can: TenantsCan }) {
  const router = useRouter()
  const { client, act } = usePlatform()
  const [view, setView] = useState<LiveView>(initial)
  const [sort, setSort] = useState<LiveSort>(DEFAULT_LIVE_SORT)
  const [target, setTarget] = useState<LiveTenantRow | null>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(q)
  const counts = useMemo(() => viewCounts(data.rows), [data.rows])
  const rows = useMemo(() => sortRows(viewRows(data.rows, view, search), sort), [data.rows, view, search, sort])
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize))
  const partial = data.total > data.rows.length

  const href = (page: number) => `/platform/tenants?${new URLSearchParams({ ...(page > 1 ? { page: String(page) } : {}), ...(view !== "all" ? { view } : {}), ...(search ? { q: search } : {}) })}`

  function changeView(v: LiveView) {
    setView(v)
    const url = new URL(window.location.href)
    if (v === "all") url.searchParams.delete("view")
    else url.searchParams.set("view", v)
    window.history.replaceState(null, "", `${url.pathname}${url.search}`)
  }

  function exportCsv() {
    const csv = toCsv(rows.map((t) => ({
      id: t.id, name: t.name, slug: t.slug, plan: t.plan, status: TENANT_STATUS[t.status].label, health: HEALTH_PILL[t.health].label, seats: t.seats ?? "", users: t.usage.seats, active30d: t.usage.activeUsers30d,
      storageBytes: t.usage.storageBytes, ...(can.revenue ? { mrr: t.currency ? (t.mrrCents / 100).toFixed(2) : "", currency: t.currency ?? "" } : {}), created: t.createdAt.slice(0, 10),
    })), [
      { key: "id", label: "ID" }, { key: "name", label: "Name" }, { key: "slug", label: "Slug" }, { key: "plan", label: "Plan" }, { key: "status", label: "Status" }, { key: "health", label: "Health" },
      { key: "seats", label: "Seats" }, { key: "users", label: "Users" }, { key: "active30d", label: "Active 30d" }, { key: "storageBytes", label: "Storage bytes" },
      ...(can.revenue ? [{ key: "mrr" as const, label: "MRR" }, { key: "currency" as const, label: "Currency" }] : []), { key: "created", label: "Created" },
    ])
    downloadCsv(csv, `tenants-page-${data.page}.csv`)
    toast.success("CSV exported")
  }

  const suspended = target?.status === "suspended"
  return (
    <>
      <PageHead
        title="Tenants"
        subtitle={`${data.total} ${data.total === 1 ? "company" : "companies"} on the platform`}
        actions={<button type="button" className="btn btn-outline" onClick={exportCsv} disabled={rows.length === 0}><Icon name="download" />Export CSV</button>}
      />
      <div className="card pf-card">
        <FilterBar>
          <FilterSeg label="Saved views" value={view} onChange={changeView} options={LIVE_VIEWS.map((v) => ({ value: v.value, label: <>{v.label} <span className="num pf-count">{counts[v.value]}</span></> }))} />
          <FilterSearch value={search} onChange={setSearch} placeholder="Search name or slug" />
          <span className="pf-sort-m">
            <FilterSelect label="Sort by" value={`${sort.key}:${sort.dir}`} options={SORTS} onChange={(v) => { const [key, dir] = v.split(":") as [LiveSortKey, LiveSort["dir"]]; setSort({ key, dir }) }} />
          </span>
        </FilterBar>
        {partial && <p className="pf-note">Views, search and sort apply to the {data.rows.length} tenants on this page.</p>}
        {rows.length > 0 ? (
          <>
            <div className="table-wrap">
              <table className={`rtable pf-table pf-tenants${can.revenue ? "" : " pf-no-mrr"}`}>
                <thead>
                  <tr>
                    <th>Tenant</th><th>Plan</th><th>Status</th><th>Health</th><th>Users</th><th className="pf-r">Active 30d</th><th className="pf-r">Storage</th>
                    {can.revenue && <th className="pf-r">MRR</th>}<th>Created</th><th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td data-label="Tenant" className="pf-tcell">
                        <div className="pf-tname">
                          <Link href={tenantPath(t.id)} className="tt pf-link">{t.name}</Link>
                          <span className="pf-slug"><span className="num">{t.slug}</span><CopyId value={t.id} what="tenant ID" /></span>
                        </div>
                      </td>
                      <td data-label="Plan">{t.plan || "—"}</td>
                      <td data-label="Status"><StatusPill status={TENANT_STATUS[t.status]} /></td>
                      <td data-label="Health"><StatusPill status={HEALTH_PILL[t.health]} /></td>
                      <td data-label="Users" className="pf-users">
                        <span className="num">{t.usage.seats}{t.seats !== null ? ` / ${t.seats}` : ""}</span>
                        {t.seats !== null && t.seats > 0 && (
                          <span className="pf-seat" data-state={seatState(t.usage.seats, t.seats)} aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round((t.usage.seats / t.seats) * 100))}%` }} /></span>
                        )}
                      </td>
                      <td data-label="Active 30d" className="num pf-r">{t.usage.activeUsers30d}</td>
                      <td data-label="Storage" className="num pf-r">{bytes(t.usage.storageBytes)}</td>
                      {can.revenue && <td data-label="MRR" className="num pf-r">{t.currency && t.mrrCents > 0 ? minorMoney(t.mrrCents, t.currency) : "—"}</td>}
                      <td data-label="Created" className="num"><time dateTime={t.createdAt}>{dateUtc(t.createdAt)}</time></td>
                      <td className="pf-menu-cell">
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<button type="button" className="pf-more" aria-label={`Actions for ${t.name}`} />}><Icon name="more" /></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" sideOffset={6} className="od-menu pf-row-menu">
                            <DropdownMenuItem onClick={() => router.push(tenantPath(t.id))}><Icon name="arrow" />Open</DropdownMenuItem>
                            {can.support && <DropdownMenuItem onClick={() => router.push(`/platform/support?request=${encodeURIComponent(t.id)}`)}><Icon name="help" />Request support access</DropdownMenuItem>}
                            {can.suspend && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className={t.status === "suspended" ? undefined : "pf-danger"} onClick={() => { setTarget(t); setOpen(true) }}>
                                  <Icon name={t.status === "suspended" ? "unlock" : "lock"} />{t.status === "suspended" ? "Reactivate" : "Suspend"}
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DataPagination page={data.page} pageCount={pageCount} total={data.total} from={(data.page - 1) * data.pageSize + 1} to={Math.min(data.total, data.page * data.pageSize)} label="Tenants pages" href={href} />
          </>
        ) : (
          <EmptyState icon="folder" title="No tenants match" text={view !== "all" || search ? "Try a different search or view." : "No companies have signed up yet."} />
        )}
      </div>
      {can.suspend && target && (
        <SlugConfirmDialog
          open={open}
          onOpenChange={setOpen}
          title={suspended ? `Reactivate ${target.name}?` : `Suspend ${target.name}?`}
          text={suspended ? `${target.name} gets access again. The reason is recorded in the platform audit trail.` : `Everyone at ${target.name} loses access until you reactivate it. Their data is kept. The reason is recorded in the platform audit trail.`}
          reason
          reasonMin={1}
          reasonMax={500}
          slug={suspended ? undefined : target.slug}
          confirmLabel={suspended ? "Reactivate" : "Suspend"}
          destructive={!suspended}
          onConfirm={(reason) => void act(`tenant:${target.id}`, () => (suspended ? client.reactivate(target.id, reason) : client.suspend(target.id, reason)), suspended ? `${target.name} reactivated` : `${target.name} suspended`)}
        />
      )}
    </>
  )
}
