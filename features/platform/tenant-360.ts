import type { ProductModule } from "@/lib/entitlements"
import { hasPaymentMethod, type InvoiceRow } from "./billing"
import { healthScore } from "./health"
import { filterAudit, planOf } from "./logic"
import { requireStaff } from "./permissions"
import type {
  AuditEntry, DataRequest, Health, PlanLimits, PlatformAction, PlatformSeed, PlatformTenant, StaffMember, SupportRequest, TenantStatus, TenantTab, UsagePoint,
} from "./types"
import { LIMITS, TENANT_STATUS } from "./types"

// The tenant 360 view models (Task 5, D9), built on the server like overview.ts / tenants.ts. The header gets the tenant
// record and what its actions need; each tab route builds only its own slice. Privacy (D8): counts, contacts and admins
// only, never members or operational records. Amounts (prices, MRR, invoices, credit, payment method) only with
// billing.read (D3). Edits go to the patch stores (store.ts), never to the full-record stores.

export const TENANT_TABS: { id: TenantTab; label: string; action: PlatformAction }[] = [
  { id: "overview", label: "Overview", action: "tenants.read" },
  { id: "billing", label: "Billing", action: "billing.read" },
  { id: "usage", label: "Usage", action: "tenants.read" },
  { id: "modules", label: "Modules", action: "tenants.read" },
  { id: "support", label: "Support", action: "tenants.read" },
  { id: "audit", label: "Audit", action: "audit.read" },
  { id: "settings", label: "Settings", action: "tenants.read" },
]
export const isTenantTab = (v: unknown): v is TenantTab => TENANT_TABS.some((t) => t.id === v)
export const tabAction = (tab: TenantTab): PlatformAction => TENANT_TABS.find((t) => t.id === tab)!.action
export const tenantPath = (id: string, tab: TenantTab | "change-plan" | "extend-trial" | "schedule-deletion" = "overview") =>
  `/platform/tenants/${encodeURIComponent(id)}/${tab}`

/** A plan as the 360 shows it: price and currency only with billing.read. */
export type PlanLite = { id: string; name: string; priceMonthly: number | null; currency: string; limits: PlanLimits; archived?: boolean }

export type T360Can = {
  /** billing.read: prices, MRR, invoices, credit, payment method. */
  amounts: boolean
  /** billing.write: change plan, extend trial, apply credit, cancel at period end, retry payment. */
  billing: boolean
  suspend: boolean
  /** tenants.lifecycle: change slug, schedule deletion. */
  lifecycle: boolean
  modules: boolean
  notes: boolean
  support: boolean
  /** data.requests: export tenant data. */
  dataRequests: boolean
}

export type T360Head = {
  tenant: PlatformTenant
  plans: PlanLite[]
  /** Health for each status, so a suspend or reactivate here shows the right pill without recomputing. */
  health: Partial<Record<TenantStatus, Health>>
  /** Unpaid invoices (failed or open), newest first, for "Retry payment"; empty without billing.read. */
  unpaid: InvoiceRow[]
  provider: { name: string; mode: string }
  /** The highest subscription-event and data-request ids platform-wide, so ids made here don't collide. */
  ids: { sub: string; dsr: string }
  can: T360Can
}

const maxId = (ids: string[], prefix: string) => {
  const n = ids.reduce((m, id) => Math.max(m, parseInt(id.replace(/\D/g, ""), 10) || 0), 0)
  return `${prefix}-${n}`
}

/** D3: what a role without billing.read gets of a tenant record: no payment method, last invoice or credit. */
export function withoutAmounts(t: PlatformTenant): PlatformTenant {
  const billing = { ...t.billing, paymentMethod: "" }
  delete billing.lastInvoice
  const out: PlatformTenant = { ...t, billing }
  delete out.creditBalance
  return out
}

export const toRow = (i: PlatformSeed["invoices"][number], t: PlatformTenant): InvoiceRow => ({
  ...i, tenantName: t.name, tenantSlug: t.slug, tenantStatus: t.status, paymentMethod: t.billing.paymentMethod, hasPaymentMethod: hasPaymentMethod(t.billing.paymentMethod),
})

export function tenant360Head(seed: PlatformSeed, id: string, op: StaffMember, payments: { provider: string; mode: string }): T360Head | null {
  const t = seed.tenants.find((x) => x.id === id)
  if (!t) return null
  const amounts = requireStaff(op, "billing.read")
  const plan = planOf(seed.plans, t.plan)
  const invoices = seed.invoices.filter((i) => i.tenantId === t.id)
  const usage = seed.usage[t.id] ?? []
  const open = seed.requests.filter((r) => r.tenantId === t.id && r.status === "requested").length
  const health: T360Head["health"] = {}
  for (const s of Object.keys(TENANT_STATUS) as TenantStatus[]) health[s] = healthScore({ ...t, status: s }, plan, usage, invoices, open)
  return {
    tenant: amounts ? t : withoutAmounts(t),
    plans: seed.plans.map((p) => ({ id: p.id, name: p.name, priceMonthly: amounts ? p.priceMonthly : null, currency: amounts ? p.currency : "", limits: p.limits, ...(p.archived ? { archived: true } : {}) })),
    health,
    unpaid: amounts
      ? invoices.filter((i) => i.status === "failed" || i.status === "open").sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).map((i) => toRow(i, t))
      : [],
    provider: { name: payments.provider, mode: payments.mode },
    ids: { sub: maxId(seed.subscriptions.map((e) => e.id), "SUB"), dsr: maxId(seed.dataRequests.map((r) => r.id), "DSR") },
    can: {
      amounts,
      billing: requireStaff(op, "billing.write"),
      suspend: requireStaff(op, "tenants.suspend"),
      lifecycle: requireStaff(op, "tenants.lifecycle"),
      modules: requireStaff(op, "tenants.modules"),
      notes: requireStaff(op, "tenants.notes"),
      support: requireStaff(op, "support.request"),
      dataRequests: requireStaff(op, "data.requests"),
    },
  }
}

/** Tabs the operator may open, in order. */
export const tabsFor = (op: StaffMember): TenantTab[] => TENANT_TABS.filter((t) => requireStaff(op, t.action)).map((t) => t.id)

// ---------- Usage ----------

/** Users and storage are levels (today's value vs the limit); messages and transcription are monthly allowances. */
export const USAGE_KIND: Record<keyof PlanLimits, "level" | "flow"> = { activeUsers: "level", storageGb: "level", messages: "flow", transcriptionMinutes: "flow" }
export type SeriesPoint = { date: string; value: number }
export type UsageMetric = { key: keyof PlanLimits; label: string; unit: string; kind: "level" | "flow"; used: number; series: SeriesPoint[] }

/**
 * The plotted series of one metric, oldest first. A level is the day's value; a monthly allowance is the month-to-date
 * total (it resets on the 1st), so both read against the plan limit.
 */
export function usageSeries(points: UsagePoint[], key: keyof PlanLimits): SeriesPoint[] {
  if (USAGE_KIND[key] === "level") return points.map((p) => ({ date: p.date, value: p[key] }))
  let month = ""
  let sum = 0
  return points.map((p) => {
    if (p.date.slice(0, 7) !== month) {
      month = p.date.slice(0, 7)
      sum = 0
    }
    sum += p[key]
    return { date: p.date, value: Math.round(sum * 10) / 10 }
  })
}

/** The four metrics with their last `days` of points; `used` is the tenant's metered value (what limits are billed on). */
export function usageMetrics(t: PlatformTenant, points: UsagePoint[], days: number): UsageMetric[] {
  const all = LIMITS.map((l) => ({ l, series: usageSeries(points, l.key) }))
  return all.map(({ l, series }) => ({ key: l.key, label: l.label, unit: l.unit, kind: USAGE_KIND[l.key], used: t[l.used], series: series.slice(-days) }))
}

// ---------- Tab slices ----------

export type OverviewTab = { metrics: UsageMetric[] }
export type UsageTab = { metrics: UsageMetric[] }
export type BillingTab = { invoices: InvoiceRow[] }
export type ModulesTab = { catalogue: ProductModule[]; plans: Record<string, string[]>; core: string[] }
export type SupportTab = { requests: SupportRequest[] }
export type AuditTab = { entries: AuditEntry[] }
export type SettingsTab = { retentionDays: number; takenSlugs: string[]; dataRequests: DataRequest[] }

/**
 * The override control a module row offers: reset an existing override (null), grant one the plan lacks, revoke one it
 * has, or nothing (undefined) for a core module the plan has, which can't be revoked.
 */
export function moduleAction(m: { inPlan: boolean; override?: "grant" | "revoke" }, core: boolean): "grant" | "revoke" | null | undefined {
  if (m.override) return null
  if (!m.inPlan) return "grant"
  return core ? undefined : "revoke"
}

export const SPARK_DAYS = 30
export const CHART_DAYS = 90

export function overviewTab(seed: PlatformSeed, t: PlatformTenant): OverviewTab {
  return { metrics: usageMetrics(t, seed.usage[t.id] ?? [], SPARK_DAYS) }
}
export function usageTab(seed: PlatformSeed, t: PlatformTenant): UsageTab {
  return { metrics: usageMetrics(t, seed.usage[t.id] ?? [], CHART_DAYS) }
}
/** Gated on billing.read by the route. Newest first. */
export function billingTab(seed: PlatformSeed, t: PlatformTenant): BillingTab {
  return { invoices: seed.invoices.filter((i) => i.tenantId === t.id).sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).map((i) => toRow(i, t)) }
}
export function modulesTab(seed: PlatformSeed): ModulesTab {
  return { catalogue: seed.entitlements.productModules, plans: seed.entitlements.plans, core: seed.entitlements.core ?? [] }
}
export function supportTab(seed: PlatformSeed, t: PlatformTenant): SupportTab {
  return { requests: seed.requests.filter((r) => r.tenantId === t.id).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)) }
}
export function auditTab(seed: PlatformSeed, t: PlatformTenant): AuditTab {
  return { entries: filterAudit(seed.audit, { tenantId: t.id, name: t.name }) }
}
export function settingsTab(seed: PlatformSeed, t: PlatformTenant, retentionDays: number): SettingsTab {
  return {
    retentionDays,
    takenSlugs: seed.tenants.filter((x) => x.id !== t.id).map((x) => x.slug),
    dataRequests: seed.dataRequests.filter((r) => r.tenantId === t.id && r.subject === "tenant").sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)),
  }
}
