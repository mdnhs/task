import { filterForStaff, requireStaff } from "./permissions"
import type { StaffMember } from "./types"

// One row of the platform console's search index (D1). Same shape as features/search's SearchItem, declared here so the two features stay independent; app/actions/platform-search.ts hands it to
// the search component (⌘K palette). B6 T6.8: the index is the console pages and the tenants the API lists (name, slug, id), plus "Request support access for …".
// Invoices, support requests and staff are not indexed: they have no API behind them here (ruling I16) or are one click away on their page.
export type PlatformSearchType = "page" | "tenant" | "action"
export type PlatformSearchItem = {
  id: string
  type: PlatformSearchType
  title: string
  ref: string
  href: string
  dept: string
  owner: string
  status: string
  date: string
  /** Matched but not shown: tenant slug and id. */
  keywords?: string
}

/** A quick action in the idle palette (same shape as features/search's QuickAction). */
export type PlatformQuickAction = { id: string; label: string; href: string; icon: string }

export type PlatformSearchSources = {
  pages: { href: string; label: string; section?: string }[]
  tenants: { id: string; name: string; slug: string; plan: string; status: string; createdAt: string }[]
}

const q = encodeURIComponent

// Shown before the operator types. Each link is gated by the same page map as the nav (filterForStaff).
export const PLATFORM_QUICK_ACTIONS: PlatformQuickAction[] = [
  { id: "past-due", label: "Past due tenants", href: "/platform/tenants?view=past_due", icon: "building" },
  { id: "suspended", label: "Suspended tenants", href: "/platform/tenants?view=suspended", icon: "lock" },
  { id: "support", label: "Request support access", href: "/platform/support", icon: "help" },
  { id: "dsr", label: "Data requests", href: "/platform/data-requests", icon: "download" },
]

export const platformQuickActions = (op: StaffMember): PlatformQuickAction[] => filterForStaff(PLATFORM_QUICK_ACTIONS, op)

/** Built on the server and filtered by the operator's staff role (D3): a row only appears when its page may be opened. Never tenant operational data (D8). */
export function buildPlatformIndex(src: PlatformSearchSources, op: StaffMember): PlatformSearchItem[] {
  const row = (r: Omit<PlatformSearchItem, "dept" | "owner" | "status" | "date"> & Partial<PlatformSearchItem>): PlatformSearchItem => ({ dept: "", owner: "", status: "", date: "", ...r })
  const items: PlatformSearchItem[] = filterForStaff(src.pages, op).map((p) => row({ id: `page:${p.href}`, type: "page", title: p.label, ref: p.section ?? "Console", href: p.href }))
  if (requireStaff(op, "tenants.read"))
    items.push(...src.tenants.map((t) => row({ id: `tenant:${t.id}`, type: "tenant", title: t.name, ref: t.slug, href: `/platform/tenants/${q(t.id)}`, owner: t.plan, status: t.status, date: t.createdAt, keywords: `${t.slug} ${t.id}` })))
  if (requireStaff(op, "support.request"))
    items.push(...src.tenants.filter((t) => t.status !== "suspended").map((t) => row({ id: `action:support:${t.id}`, type: "action", title: `Request support access for ${t.name}`, ref: "Support access", href: `/platform/support?request=${q(t.id)}`, keywords: `${t.slug} ${t.id}` })))
  return items
}
