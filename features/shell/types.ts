import type { NavItemData, NavigationData, Role, Tenant } from "@/lib/types"

// Navigation types live in lib/types.ts (the platform console shares them); re-exported for the shell.
export type { NavItemData, NavigationData }

export type UserData = { name: string; role: string; email: string; initials: string }

/** The device this request comes from, as the API resolved it (CR-02): read-only in the shell. */
export type ShellDevice = { label: string; registered: boolean }
export type ShellSession = { role: Role; roles: Role[]; tenant: Tenant; tenants: Tenant[]; device?: ShellDevice }

export type NotificationType =
  | "assigned"
  | "reassigned"
  | "deadline"
  | "evidence"
  | "report-returned"
  | "manager-action"
  | "reminder"
  // Platform console alerts (D1): a tenant's payment failed, support access waits, a trial is ending.
  | "payment"
  | "access"
  | "trial"
  // The API's notification kinds (B6 T6.4): the company bell lists what the API wrote.
  | "task" | "report" | "billing" | "security" | "invite" | "member" | "file" | "dsr" | "system"
// Titles stay generic: no names, amounts or other sensitive details (FR-NOT-04); the API redacts them.
export type Notification = { id: string; type: NotificationType; title: string; at: string; read: boolean; href: string }
