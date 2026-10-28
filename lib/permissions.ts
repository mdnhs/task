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
