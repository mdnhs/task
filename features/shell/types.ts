import type { NavItemData, NavigationData, Role, Tenant } from "@/lib/types"

// Navigation types live in lib/types.ts (the platform console shares them); re-exported for the shell.
export type { NavItemData, NavigationData }

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
