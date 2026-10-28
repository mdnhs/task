import type { Dept, Role, Tenant } from "@/lib/types"

export type NavItemData = {
  href: string
  icon: string
  label: string
  badge?: { text: string; alert?: boolean }
  lock?: boolean
  // Shown on the Coming soon page until the feature is built.
  description?: string
  srs?: string
}
export type NavigationData = {
  menu: NavItemData[]
  general: NavItemData[]
  departments: { dep: Dept; label: string }[]
}
export type UserData = { name: string; role: string; email: string; initials: string }

export type ShellSession = { role: Role; roles: Role[]; tenant: Tenant; tenants: Tenant[] }

export type NotificationType =
  | "assigned"
  | "reassigned"
  | "deadline"
  | "evidence"
  | "report-returned"
  | "manager-action"
  | "reminder"
// Titles stay generic: no names, amounts or other sensitive details (FR-NOT-04).
export type Notification = { id: string; type: NotificationType; title: string; at: string; read: boolean; href: string }
