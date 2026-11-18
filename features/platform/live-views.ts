// Saved views, sort and filter of the live tenants list (B6 T6.8). The API pages and filters by name, slug, status and plan; it does not sort and has no subscription-status filter, so the views
// that need one (trial, past due), and every sort, work on the rows of the loaded page (a page holds up to 100 tenants).
import type { LiveTenantRow } from "./adapters"
import type { TenantStatus } from "./types"

export type LiveView = "all" | "trial" | "past_due" | "suspended"
export const LIVE_VIEWS: { value: LiveView; label: string }[] = [
  { value: "all", label: "All" }, { value: "trial", label: "Trial" }, { value: "past_due", label: "Past due" }, { value: "suspended", label: "Suspended" },
]
export const isLiveView = (v: unknown): v is LiveView => LIVE_VIEWS.some((x) => x.value === v)
const STATUS_OF: Record<Exclude<LiveView, "all">, TenantStatus> = { trial: "trial", past_due: "past_due", suspended: "suspended" }

export const viewRows = (rows: LiveTenantRow[], view: LiveView, q = ""): LiveTenantRow[] => {
  const needle = q.trim().toLowerCase()
  return rows.filter((r) => (view === "all" || r.status === STATUS_OF[view]) && (!needle || `${r.name} ${r.slug}`.toLowerCase().includes(needle)))
}
export const viewCounts = (rows: LiveTenantRow[]): Record<LiveView, number> => ({ all: rows.length, trial: viewRows(rows, "trial").length, past_due: viewRows(rows, "past_due").length, suspended: viewRows(rows, "suspended").length })

export type LiveSortKey = "name" | "plan" | "status" | "seats" | "created"
export type LiveSort = { key: LiveSortKey; dir: "asc" | "desc" }
export const DEFAULT_LIVE_SORT: LiveSort = { key: "created", dir: "desc" }
export function sortRows(rows: LiveTenantRow[], { key, dir }: LiveSort): LiveTenantRow[] {
  const val = (r: LiveTenantRow): string | number => (key === "name" ? r.name.toLowerCase() : key === "plan" ? r.plan : key === "status" ? r.status : key === "seats" ? r.seats ?? -1 : r.createdAt)
  return [...rows].sort((a, b) => {
    const x = val(a)
    const y = val(b)
    const c = x < y ? -1 : x > y ? 1 : a.id.localeCompare(b.id)
    return dir === "asc" ? c : -c
  })
}
