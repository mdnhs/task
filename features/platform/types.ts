import type { EntitlementsData, ModuleOverride } from "@/lib/entitlements"
import type { SupportAccess, SupportStatus } from "@/lib/support-access"
import type { PlatformNotice } from "@/lib/platform-notice"
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
  /** The status a suspend interrupted, so reactivate returns to it (Review Focus 5). Seed suspensions lack it. */
  statusBeforeSuspend?: TenantStatus
  /** Per-tenant add-on grants and revokes on top of the plan (tenant 360 → Modules); they feed lib/entitlements.ts. */
  moduleOverrides?: TenantModuleOverride[]
  /** Staff-only notes (never shown to the tenant); every note is audited. */
  notes?: InternalNote[]
  /** Account credit (plan currency), used up by the next invoices. */
  creditBalance?: number
  /** The subscription ends at the current period's end (renewsOn) instead of renewing. */
  cancelAtPeriodEnd?: boolean
  /** YYYY-MM-DD: the workspace and its data are deleted on this day (scheduled after the retention period). */
  deletionAt?: string
}

export type TenantModuleOverride = ModuleOverride & { reason: string; at: string; by: string }
export type InternalNote = { id: string; at: string; by: string; text: string }

export type PlanLimits = { activeUsers: number; storageGb: number; messages: number; transcriptionMinutes: number }
export type Plan = {
  id: string
  name: string
  priceMonthly: number
  currency: string
  trialDays: number
  limits: PlanLimits
  /** Archived plans keep their tenants but can't be picked for new ones (Task 7). */
  archived?: boolean
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
export type AuditEntry = {
  id: string; at: string; actor: string; action: string; target: string; detail: string
  /** The tenant the action was on (set by every platform writer from Task 5 on; older lines only name it in `target`). */
  tenantId?: string
  /** D7: sensitive actions also record the staff role, the change and the required reason. Old entries lack them. */
  staffRole?: StaffRole
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  reason?: string
}

export type PlatformSeed = {
  tenants: PlatformTenant[]
  plans: Plan[]
  /** Plan entitlements (billing/entitlements.json): the one source of truth for which modules a plan includes (FR-M0-15). */
  entitlements: EntitlementsData
  requests: SupportRequest[]
  audit: AuditEntry[]
  subscriptions: SubEvent[]
  invoices: Invoice[]
  /** Daily points per tenant id, oldest first, ending on the platform's today. */
  usage: Record<string, UsagePoint[]>
  dataRequests: DataRequest[]
}

// D3: platform staff (the SaaS operator's own people), not tenant users. Roles and actions are mapped in permissions.ts.
export type StaffRole = "owner" | "support" | "billing" | "viewer"
export type StaffMember = { id: string; name: string; email: string; role: StaffRole; mfa: boolean; lastSignInAt: string | null; status: "active" | "invited" | "disabled" }
export type PlatformAction =
  | "tenants.read" | "tenants.suspend" | "tenants.lifecycle" | "tenants.modules" | "tenants.notes"
  | "billing.read" | "billing.write" | "plans.write"
  | "support.request" | "data.requests" | "audit.read" | "team.manage" | "settings.read" | "settings.write"

// D4: subscription events and invoices are the source of the metrics (metrics.ts); nothing aggregated is stored.
export type SubEvent = { id: string; tenantId: string; at: string; kind: "start" | "upgrade" | "downgrade" | "cancel" | "reactivate"; plan: string; mrrDelta: number }
export type InvoiceStatus = "paid" | "open" | "failed" | "refunded" | "void"
export type Invoice = {
  id: string; tenantId: string; number: string; issuedAt: string; dueAt: string; amount: number; currency: string; status: InvoiceStatus; attempts: number; nextRetryAt: string | null; lines: { label: string; amount: number }[]
  /** What the console recorded on this invoice (Task 6: retries, mark paid, refund, void). The seed has none; its
   *  issue and charge lines are derived (billing.ts → invoiceHistory). */
  events?: InvoiceEvent[]
}
export type InvoiceEventKind = "issued" | "charged" | "charge_failed" | "marked_paid" | "refunded" | "voided"
export type InvoiceEvent = { at: string; kind: InvoiceEventKind; attempt?: number; by?: string; reason?: string }
export const INVOICE_STATUS: Record<InvoiceStatus, Status> = {
  paid: { tone: "ok", label: "Paid" },
  open: { tone: "info", label: "Open" },
  failed: { tone: "bad", label: "Failed" },
  refunded: { tone: "warn", label: "Refunded" },
  void: { tone: "mute", label: "Void" },
}
export type BillingView = "all" | "open" | "failed" | "refunded"
export type InvoiceSortKey = "number" | "tenant" | "issued" | "due" | "amount" | "status" | "attempts" | "next"
export type InvoiceSort = { key: InvoiceSortKey; dir: "asc" | "desc" }
export type UsagePoint = { date: string; activeUsers: number; storageGb: number; messages: number; transcriptionMinutes: number }
export type DataRequest = { id: string; tenantId: string; kind: "export" | "deletion" | "correction"; subject: "tenant" | "person"; requestedBy: string; requestedAt: string; dueAt: string; status: DataRequestStatus; note: string
  /** Set when the request is closed (data-requests.ts): the completion note or the rejection reason, when and by whom. */
  resolution?: string; closedAt?: string; closedBy?: string }
export type DataRequestStatus = "received" | "in_progress" | "completed" | "rejected"
export type MrrMonth = { month: string /* YYYY-MM */; mrr: number; new: number; expansion: number; contraction: number; churn: number }
export type Health = { score: number; band: "healthy" | "watch" | "at_risk"; reasons: string[] }

/** The slice of a tenant the tenants list ships (Task 4): no contacts, usage counters or billing object. */
export type TenantBase = Pick<PlatformTenant, "id" | "name" | "slug" | "subdomain" | "plan" | "status" | "users" | "storageGb" | "createdAt" | "suspendedAt" | "suspendReason" | "statusBeforeSuspend">
/**
 * A tenants-list row: the slim tenant plus what the list derives on the server. `mrr` is null for a staff role without
 * billing.read, so no amount is in its payload (D3). `seatPct` is users against the plan's active-user limit (0-100+).
 */
export type TenantRow = TenantBase & { mrr: number | null; health: Health; seatPct: number }
export type TenantSortKey = "name" | "plan" | "status" | "users" | "storage" | "mrr" | "health" | "created"
export type TenantSort = { key: TenantSortKey; dir: "asc" | "desc" }
/** Saved views of the tenants list (`?view=`). */
export type TenantView = "all" | "trial" | "past_due" | "at_risk" | "suspended"

/** Tenant 360 tabs (D9): routes /platform/tenants/[id]/[tab]. */
export type TenantTab = "overview" | "billing" | "usage" | "modules" | "support" | "audit" | "settings"

/** D10. Platform settings (platform/settings.json). The announcement shows in every tenant's app shell (lib/platform-notice.ts). */
export type PlatformAnnouncement = PlatformNotice
export type PlatformSettings = {
  /** Read from the billing provider; the console shows it but never edits it. */
  payments: { provider: string; status: "connected" | "disconnected" | "error"; mode: "live" | "test" }
  defaultTrialDays: number
  retentionDays: number
  supportAccessHours: number
  announcement: PlatformAnnouncement | null
}
