import { healthScore } from "./health"
import { planOf, reactivateTenant, tenantMrr } from "./logic"
import { requireStaff } from "./permissions"
import type { Health, PlatformSeed, PlatformTenant, StaffMember, TenantBase, TenantRow, TenantStatus } from "./types"
import { TENANT_STATUS } from "./types"

// The /platform/tenants view model (Task 4), built on the server like overview.ts. Only what the list renders or its
// actions need reaches the client: slim rows (TenantBase: no contacts, usage counters, billing object or audit log),
// plus per tenant its plan facts and, per status, its MRR and health, so a suspend or reactivate in the list shows the
// right pill and amount without recomputing. MRR is null and the currency "" for a staff role without billing.read
// (D3). Edits go to the patch stores (store.ts), never to the full-record stores.

export type TenantFacts = { mrr: number | null; health: Health }
export type TenantDerived = {
  planName: string
  /** Position in the plans list (cheapest first), for the plan sort. */
  planRank: number
  userLimit: number
  /** The plan currency, "" without billing.read. */
  currency: string
  /** What a reactivate returns this tenant to (decided on the server, where the billing dates are). */
  reactivatesAs: TenantStatus
  byStatus: Partial<Record<TenantStatus, TenantFacts>>
}
export type TenantsData = {
  tenants: TenantBase[]
  derived: Record<string, TenantDerived>
  plans: { id: string; name: string }[]
  /** `amounts` = billing.read: MRR, its column, sort and CSV columns. */
  can: { amounts: boolean; suspend: boolean; support: boolean }
}
/** A row as the table shows it. */
export type TenantListRow = TenantRow & Omit<TenantDerived, "byStatus" | "reactivatesAs">

/** The list's slice of a tenant record. */
export const toBase = ({ id, name, slug, subdomain, plan, status, users, storageGb, createdAt, suspendedAt, suspendReason, statusBeforeSuspend }: PlatformTenant): TenantBase => ({
  id, name, slug, subdomain, plan, status, users, storageGb, createdAt,
  ...(suspendedAt ? { suspendedAt } : {}),
  ...(suspendReason ? { suspendReason } : {}),
  ...(statusBeforeSuspend ? { statusBeforeSuspend } : {}),
})

export function tenantsData(seed: PlatformSeed, op: StaffMember): TenantsData {
  const billing = requireStaff(op, "billing.read")
  const derived: Record<string, TenantDerived> = {}
  for (const t of seed.tenants) {
    const plan = planOf(seed.plans, t.plan)
    const invoices = seed.invoices.filter((i) => i.tenantId === t.id)
    const usage = seed.usage[t.id] ?? []
    const open = seed.requests.filter((r) => r.tenantId === t.id && r.status === "requested").length
    const byStatus: TenantDerived["byStatus"] = {}
    for (const s of Object.keys(TENANT_STATUS) as TenantStatus[]) {
      const as = { ...t, status: s }
      byStatus[s] = { mrr: billing ? tenantMrr(as, seed.plans) : null, health: healthScore(as, plan, usage, invoices, open) }
    }
    derived[t.id] = {
      planName: plan?.name ?? t.plan,
      planRank: plan ? seed.plans.indexOf(plan) : seed.plans.length,
      userLimit: plan?.limits.activeUsers ?? 0,
      currency: billing ? (plan?.currency ?? "") : "",
      reactivatesAs: reactivateTenant({ ...t, status: "suspended" }).status,
      byStatus,
    }
  }
  return {
    tenants: seed.tenants.map(toBase),
    derived,
    plans: seed.plans.map((p) => ({ id: p.id, name: p.name })),
    can: { amounts: billing, suspend: requireStaff(op, "tenants.suspend"), support: requireStaff(op, "support.request") },
  }
}

const NO_HEALTH: Health = { score: 0, band: "at_risk", reasons: [] }

/** Joins the live rows (server rows with any patches applied) with what the server derived; unknown ids are left out. */
export function liveRows(tenants: TenantBase[], derived: Record<string, TenantDerived>): TenantListRow[] {
  return tenants.flatMap((t) => {
    const d = derived[t.id]
    if (!d) return []
    const { planName, planRank, userLimit, currency, byStatus } = d
    const now = byStatus[t.status] ?? { mrr: null, health: NO_HEALTH }
    return [{ ...t, planName, planRank, userLimit, currency, mrr: now.mrr, health: now.health, seatPct: d.userLimit > 0 ? Math.round((t.users / d.userLimit) * 100) : 0 }]
  })
}
