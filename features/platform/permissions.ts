import type { PlatformAction, StaffMember, StaffRole } from "./types"

// D3: one permission map for the platform console. Pages gate on the server with requireStaff; buttons hide with staffCan.
export const STAFF_ROLES: StaffRole[] = ["owner", "support", "billing", "viewer"]

export const PLATFORM_ACTIONS: PlatformAction[] = [
  "tenants.read", "tenants.suspend", "tenants.lifecycle", "tenants.modules", "tenants.notes",
  "billing.read", "billing.write", "plans.write",
  "support.request", "data.requests", "audit.read", "team.manage", "settings.read", "settings.write",
]

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = { owner: "Owner", support: "Support", billing: "Billing", viewer: "Viewer" }

const READ = PLATFORM_ACTIONS.filter((a) => a.endsWith(".read"))

const MAP: Record<StaffRole, ReadonlySet<PlatformAction>> = {
  owner: new Set(PLATFORM_ACTIONS),
  support: new Set<PlatformAction>(["tenants.read", "tenants.notes", "support.request", "data.requests", "settings.read"]),
  billing: new Set<PlatformAction>(["tenants.read", "tenants.notes", "billing.read", "billing.write", "plans.write", "settings.read"]),
  viewer: new Set(READ),
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
  ["/platform/settings", "settings.read"], // every role views it; saving needs settings.write
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
