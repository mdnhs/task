import type { Access, Module, Role, Tenant } from "./types"

export type { Access, Module, Role } from "./types"

const RANK: Record<Access, number> = { none: 0, read: 1, write: 2 }

// write implies read
export function can(role: Role, module: Module, need: "read" | "write" = "read"): boolean {
  return RANK[role.access[module]] >= RANK[need]
}

const PREFIXES: [string, Module][] = [
  ["/tasks", "tasks"],
  ["/daily-reports", "reports"],
  ["/manager-attention", "attention"],
  ["/staff-rosters", "staff"],
  ["/shifts", "shifts"],
  ["/recruitment", "recruitment"],
  ["/files", "files"],
  ["/payroll-issues", "payroll"],
  ["/orders-stock", "orders"],
  ["/whatsapp", "whatsapp"],
  ["/settings", "settings"],
  ["/audit-log", "audit"],
]

export function moduleForHref(href: string): Module | null {
  const p = href.split(/[?#]/)[0]
  if (p === "/") return "dashboard"
  for (const [prefix, m] of PREFIXES) if (p === prefix || p.startsWith(prefix + "/")) return m
  return null
}

// Suspended tenants are read-only (FR-SAAS-08).
export function canWriteFor(role: Role, tenantStatus: Tenant["status"], module: Module): boolean {
  return tenantStatus !== "suspended" && can(role, module, "write")
}

// Report review (accept, return, comment, follow-up): manager-home roles with write access to reports.
// Staff-home roles act as a report owner ("me"), so they never review.
export function canReview(role: Role, tenantStatus: Tenant["status"] = "active"): boolean {
  return role.home === "manager" && canWriteFor(role, tenantStatus, "reports")
}

// Drops nav items whose module the role can't open (server-side, so hidden modules never reach the client).
export function filterNav<T extends { href: string }>(items: T[], role: Role): T[] {
  return items.filter((n) => can(role, moduleForHref(n.href) ?? "dashboard"))
}

// Shifts (FR-M1-20/21, FR-M0-07): roles with write access edit everyone's shifts; manager-home readers (auditor) see everyone read-only;
// other readers (staff-home roles) get only their own shifts, cut on the server with ownShiftState() (lib/shifts.ts).
export function shiftScope(role: Role): "all" | "own" | "none" {
  if (!can(role, "shifts")) return "none"
  return can(role, "shifts", "write") || role.home === "manager" ? "all" : "own"
}

// End-of-shift reports (FR-M1-28): staff-home roles see only their own (as `meId`); a manager-home role marked
// `reportScope: "team"` sees the people below its `person` in the reporting lines; other manager-home roles see all.
export type ReportAccess = { kind: "all" } | { kind: "team"; managerId: string } | { kind: "own"; personId: string }
export function reportScope(role: Role, meId: string): ReportAccess | null {
  if (!can(role, "reports")) return null
  if (role.home === "staff") return { kind: "own", personId: meId }
  if (role.reportScope === "team" && role.person) return { kind: "team", managerId: role.person }
  return { kind: "all" }
}
