import type { Module } from "@/lib/types"

// Page sizes (full-page tables 10, tables inside small cards 5).
export const USERS_PAGE_SIZE = 10
export const INVITES_PAGE_SIZE = 5
export const DEPARTMENTS_PAGE_SIZE = 5
export const GRANTS_PAGE_SIZE = 5
export const DELIVERY_PAGE_SIZE = 10
export const DEVICES_PAGE_SIZE = 10
export const MATRIX_MODULE_LABELS: { id: Module; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "tasks", label: "Tasks" },
  { id: "reports", label: "Shift Reports" },
  { id: "attention", label: "Manager Attention" },
  { id: "roster", label: "Location Rosters" },
  { id: "staff", label: "Staff & Rosters" },
  { id: "shifts", label: "Shifts" },
  { id: "recruitment", label: "Recruitment" },
  { id: "files", label: "Files" },
  { id: "payroll", label: "Payroll Issues" },
  { id: "orders", label: "Orders & Stock" },
  { id: "settings", label: "Settings" },
  { id: "audit", label: "Audit Log" },
]
export const MATRIX_MODULES: Module[] = MATRIX_MODULE_LABELS.map((m) => m.id)
/** Hosts a Google consent URL may live on (the Google start answer is followed only when it is https on one of these). */
export const OAUTH_REDIRECT_HOSTS: readonly string[] = ["accounts.google.com"]
/** Rows of the data-request and grant lists. */
export const REQUESTS_PAGE_SIZE = 5
