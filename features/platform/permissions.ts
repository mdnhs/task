import type { PlatformAction, StaffMember, StaffRole } from "./types"

// D3: one permission map for the platform console. Pages gate on the server with requireStaff; buttons hide with staffCan.
export const STAFF_ROLES: StaffRole[] = ["owner", "support", "billing", "viewer"]

export const PLATFORM_ACTIONS: PlatformAction[] = [
  "tenants.read", "tenants.suspend", "tenants.lifecycle", "tenants.modules", "tenants.notes",
  "billing.read", "billing.write", "plans.write",
  "support.request", "data.requests", "data.resolve", "audit.read", "team.manage", "settings.read", "settings.write",
]

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = { owner: "Owner", support: "Support", billing: "Billing", viewer: "Viewer" }

// Mirrors the API's role matrix (api/src/modules/platform-*: requirePlatformStaff). The API is the authority; this only hides controls and pages it would refuse.
//   tenants list/360: all roles · suspend, reactivate, extend trial, support grants: owner, support · modules, staff, settings: owner
//   metrics: owner, billing, viewer · audit: owner, viewer · data requests: all roles read, owner and support resolve (B8 T17)
// `billing.write`, `plans.write`, `tenants.lifecycle` and `tenants.notes` have no API route yet (mock pages only, shown with ENABLE_MOCK_MODULES).
const MAP: Record<StaffRole, ReadonlySet<PlatformAction>> = {
  owner: new Set(PLATFORM_ACTIONS),
  support: new Set<PlatformAction>(["tenants.read", "tenants.suspend", "tenants.notes", "support.request", "data.requests", "data.resolve"]),
  billing: new Set<PlatformAction>(["tenants.read", "tenants.notes", "billing.read", "billing.write", "plans.write", "data.requests"]),
  viewer: new Set<PlatformAction>(["tenants.read", "billing.read", "audit.read", "data.requests"]),
}

export const isStaffRole = (v: unknown): v is StaffRole => typeof v === "string" && (STAFF_ROLES as string[]).includes(v)

export function staffCan(role: StaffRole, action: PlatformAction): boolean {
  return MAP[role]?.has(action) ?? false
}

/** Page-level gate: only an active staff member whose role allows the action. */
export function requireStaff(op: StaffMember, action: PlatformAction): boolean {
  return op.status === "active" && staffCan(op.role, action)
}

// The gate for each console page (longest prefix wins). Nav items and search entries are filtered by the same map.
const PAGE_ACTIONS: [string, PlatformAction][] = [
  ["/platform/tenants", "tenants.read"],
  ["/platform/billing", "billing.read"],
  ["/platform/plans/", "plans.write"], // /platform/plans/[id]/edit
  ["/platform/plans", "billing.read"],
  ["/platform/support", "support.request"],
  ["/platform/data-requests", "data.requests"],
  ["/platform/audit", "audit.read"],
  ["/platform/team", "team.manage"],
  ["/platform/settings", "settings.read"], // the settings routes are owner-only in the API
  ["/platform", "tenants.read"],
]

export function actionForPath(path: string): PlatformAction | null {
  const p = path.split(/[?#]/)[0]
  for (const [prefix, action] of PAGE_ACTIONS) {
    if (prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix || p.startsWith(`${prefix}/`)) return action
  }
  return null
}

/** Nav items / links the operator may open. */
export function filterForStaff<T extends { href: string }>(items: T[], op: StaffMember): T[] {
  return items.filter((i) => {
    const a = actionForPath(i.href)
    return !!a && requireStaff(op, a)
  })
}
