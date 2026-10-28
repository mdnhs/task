import type { SupportAccess, SupportStatus } from "@/lib/support-access"
import type { Status } from "@/lib/types"

export type TenantStatus = "trial" | "active" | "past_due" | "suspended"

export const TENANT_STATUS: Record<TenantStatus, Status> = {
  trial: { tone: "info", label: "Trial" },
  active: { tone: "ok", label: "Active" },
  past_due: { tone: "warn", label: "Past due" },
  suspended: { tone: "bad", label: "Suspended" },
}

export type Contact = { role: string; name: string; email: string }
export type PlatformTenant = {
  id: string
  name: string
  slug: string
  subdomain: string
  /** Plan id, see Plan. */
  plan: string
  status: TenantStatus
  users: number
  storageGb: number
  messages: number
  transcriptionMinutes: number
  createdAt: string
  contacts: Contact[]
  billing: {
    paymentMethod: string
    trialEndsOn?: string
    graceEndsOn?: string
    renewsOn?: string
    lastInvoice?: { id: string; at: string; paid: boolean }
  }
  suspendedAt?: string
  suspendReason?: string
}

export type PlanLimits = { activeUsers: number; storageGb: number; messages: number; transcriptionMinutes: number }
export type Plan = {
  id: string
  name: string
  priceMonthly: number
  currency: string
  trialDays: number
  limits: PlanLimits
  modules: string[]
}

export const LIMITS: { key: keyof PlanLimits; label: string; unit: string; used: keyof Pick<PlatformTenant, "users" | "storageGb" | "messages" | "transcriptionMinutes"> }[] = [
  { key: "activeUsers", label: "Active users", unit: "", used: "users" },
  { key: "storageGb", label: "Storage", unit: "GB", used: "storageGb" },
  { key: "messages", label: "Messages", unit: "", used: "messages" },
  { key: "transcriptionMinutes", label: "Transcription", unit: "min", used: "transcriptionMinutes" },
]

export type RequestStatus = SupportStatus
export { SUPPORT_STATUS as REQUEST_STATUS } from "@/lib/support-access"

// Shared with tenant settings (lib/support-access.ts): one list, both sides.
export type SupportRequest = SupportAccess

// FR-SAAS-10: every platform action on a tenant is recorded.
export type AuditEntry = { id: string; at: string; actor: string; action: string; target: string; detail: string }

export type PlatformSeed = {
  tenants: PlatformTenant[]
  plans: Plan[]
  requests: SupportRequest[]
  audit: AuditEntry[]
}
