import { KIND_LABEL } from "./data-requests"
import { STAFF_ROLE_LABEL, filterForStaff, requireStaff } from "./permissions"
import type { DataRequest, Invoice, PlatformTenant, StaffMember, SupportRequest } from "./types"

// One row of the platform console's search index (D1). Same shape as features/search's SearchItem, declared here so
// the two features stay independent; app/actions/platform-search.ts hands it to the search component (⌘K palette).
export type PlatformSearchType = "page" | "tenant" | "invoice" | "support" | "datarequest" | "member" | "action"
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
  /** Matched but not shown: tenant slug and id, invoice id. */
  keywords?: string
}

/** A quick action in the idle palette (same shape as features/search's QuickAction). */
export type PlatformQuickAction = { id: string; label: string; href: string; icon: string }

export type PlatformSearchSources = {
  pages: { href: string; label: string; section?: string }[]
  tenants: PlatformTenant[]
  requests: SupportRequest[]
  staff: StaffMember[]
  invoices: Invoice[]
  dataRequests: DataRequest[]
}

const q = encodeURIComponent

// Shown before the operator types. Each link is gated by the same page map as the nav (filterForStaff).
export const PLATFORM_QUICK_ACTIONS: PlatformQuickAction[] = [
  { id: "at-risk", label: "At-risk tenants", href: "/platform/tenants?view=at_risk", icon: "building" },
  { id: "failed", label: "Failed payments", href: "/platform/billing?view=failed", icon: "receipt" },
  { id: "new-plan", label: "New plan", href: "/platform/plans/new", icon: "plus" },
  { id: "support", label: "Support access requests", href: "/platform/support", icon: "help" },
  { id: "due-soon", label: "Data requests due soon", href: "/platform/data-requests?view=due_soon", icon: "download" },
]

export const platformQuickActions = (op: StaffMember): PlatformQuickAction[] => filterForStaff(PLATFORM_QUICK_ACTIONS, op)

/**
 * Built on the server and filtered by the operator's staff role (D3): a row only appears when its page may be opened,
 * so invoice numbers never reach a role without billing.read. Never includes tenant operational data (D8): tenants by
 * name, subdomain, slug and id; invoices by number; support and data requests; staff; console pages; and the
 * "Request support access for …" action per tenant (support.request).
 */
export function buildPlatformIndex(src: PlatformSearchSources, op: StaffMember): PlatformSearchItem[] {
  const tenantName = new Map(src.tenants.map((t) => [t.id, t.name]))
  const nameOf = (id: string) => tenantName.get(id) ?? id
  const row = (r: Omit<PlatformSearchItem, "dept" | "owner" | "status" | "date"> & Partial<PlatformSearchItem>): PlatformSearchItem => ({
    dept: "", owner: "", status: "", date: "", ...r,
  })
  const items: PlatformSearchItem[] = filterForStaff(src.pages, op).map((p) =>
    row({ id: `page:${p.href}`, type: "page", title: p.label, ref: p.section ?? "Console", href: p.href }),
  )
  if (requireStaff(op, "tenants.read"))
    items.push(...src.tenants.map((t) => row({
      id: `tenant:${t.id}`, type: "tenant", title: t.name, ref: t.subdomain, href: `/platform/tenants/${q(t.id)}`,
      owner: t.plan, status: t.status, date: t.createdAt, keywords: `${t.slug} ${t.id}`,
    })))
  if (requireStaff(op, "billing.read"))
    items.push(...src.invoices.map((i) => row({
      id: `invoice:${i.id}`, type: "invoice", title: `Invoice ${i.number}, ${nameOf(i.tenantId)}`, ref: i.number,
      href: `/platform/billing?q=${q(i.number)}`, owner: nameOf(i.tenantId), status: i.status, date: i.issuedAt, keywords: i.id,
    })))
  if (requireStaff(op, "support.request"))
    items.push(
      ...src.requests.map((r) => row({
        id: `support:${r.id}`, type: "support", title: `${nameOf(r.tenantId)}: ${r.reason}`, ref: r.id,
        href: "/platform/support", owner: r.requester, status: r.status, date: r.requestedAt,
      })),
      ...src.tenants.map((t) => row({
        id: `action:support:${t.id}`, type: "action", title: `Request support access for ${t.name}`, ref: "Support access",
        href: `/platform/support?request=${q(t.id)}`, keywords: `${t.slug} ${t.id}`,
      })),
    )
  if (requireStaff(op, "data.requests"))
    items.push(...src.dataRequests.map((d) => row({
      id: `datarequest:${d.id}`, type: "datarequest", title: `${KIND_LABEL[d.kind]} request, ${nameOf(d.tenantId)}`, ref: d.id,
      href: `/platform/data-requests?view=all&q=${q(d.id)}`, owner: d.requestedBy, status: d.status, date: d.requestedAt,
    })))
  if (requireStaff(op, "team.manage"))
    items.push(...src.staff.map((s) => row({
      id: `member:${s.id}`, type: "member", title: s.name, ref: STAFF_ROLE_LABEL[s.role], href: "/platform/team",
      status: s.status, date: s.lastSignInAt ?? "", keywords: s.email,
    })))
  return items
}
