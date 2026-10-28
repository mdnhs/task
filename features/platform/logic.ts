import { formatDate } from "@/lib/dates"
import type { AuditEntry, Plan, PlatformTenant, TenantStatus } from "./types"

/** Org "now" as a wall-clock ISO string, e.g. 2026-10-20T09:00:00. */
export const nowIso = (today: string) => `${today.slice(0, 10)}T${today.slice(11, 16)}:00`

export const planOf = (plans: Plan[], id: string) => plans.find((p) => p.id === id)

/** Monthly recurring revenue: trials and suspended tenants don't pay; past-due ones still count until they are suspended. */
export function tenantMrr(t: PlatformTenant, plans: Plan[]): number {
  return t.status === "active" || t.status === "past_due" ? (planOf(plans, t.plan)?.priceMonthly ?? 0) : 0
}

export function summarize(tenants: PlatformTenant[], plans: Plan[]) {
  return {
    tenants: tenants.length,
    mrr: tenants.reduce((s, t) => s + tenantMrr(t, plans), 0),
    trials: tenants.filter((t) => t.status === "trial").length,
    pastDue: tenants.filter((t) => t.status === "past_due").length,
  }
}

export type TenantFilters = { q: string; status: "all" | TenantStatus; plan: string }
export const EMPTY_FILTERS: TenantFilters = { q: "", status: "all", plan: "all" }

export function filterTenants(tenants: PlatformTenant[], f: TenantFilters): PlatformTenant[] {
  const q = f.q.trim().toLowerCase()
  return tenants.filter(
    (t) =>
      (f.status === "all" || t.status === f.status) &&
      (f.plan === "all" || t.plan === f.plan) &&
      (!q || [t.name, t.slug, t.subdomain].some((s) => s.toLowerCase().includes(q))),
  )
}

export const canSuspend = (t: PlatformTenant) => t.status !== "suspended"

export function suspendTenant(t: PlatformTenant, at: string, reason: string): PlatformTenant {
  return { ...t, status: "suspended", suspendedAt: at, suspendReason: reason }
}

/** Back to active if it has a paid plan; a tenant that was still trialling resumes as a trial. */
export function reactivateTenant(t: PlatformTenant): PlatformTenant {
  const rest: PlatformTenant = { ...t, status: t.billing.trialEndsOn && !t.billing.renewsOn ? "trial" : "active" }
  delete rest.suspendedAt
  delete rest.suspendReason
  return rest
}

export function nextId(prefix: string, ids: string[]): string {
  const max = ids.reduce((m, id) => Math.max(m, parseInt(id.replace(/\D/g, ""), 10) || 0), 0)
  return `${prefix}-${max + 1}`
}

export function auditEntry(entries: AuditEntry[], at: string, actor: string, action: string, target: string, detail: string): AuditEntry {
  return { id: nextId("PAU", entries.map((e) => e.id)), at, actor, action, target, detail }
}

/** Wall-clock ISO to seconds since epoch (timezone free, both sides use the same zone). */
export { effectiveStatus, isoSeconds } from "@/lib/support-access"

/** "1d 02:15:09" / "02:15:09" for the time left; null when it has run out. */
export function formatLeft(seconds: number): string | null {
  if (seconds <= 0) return null
  const pad = (n: number) => String(n).padStart(2, "0")
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${d ? `${d}d ` : ""}${pad(h)}:${pad(m)}:${pad(Math.floor(seconds % 60))}`
}

export function currencySymbol(currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency
}

export const money = (n: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n)

export const MODULE_LABEL: Record<string, string> = {
  dashboard: "Dashboard", tasks: "Tasks", reports: "Daily reports", attention: "Manager attention", staff: "Staff & rosters",
  recruitment: "Recruitment", files: "Files", payroll: "Payroll issues", orders: "Orders & stock", audit: "Audit log", integrations: "Integrations",
}
export const moduleLabel = (id: string) => MODULE_LABEL[id] ?? id

/** "Wed 12 Mar 2025": platform dates span years, so the year is shown. */
export const dateY = (iso: string) => `${formatDate(iso)} ${iso.slice(0, 4)}`
