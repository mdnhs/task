import type { EntitlementsData } from "@/lib/entitlements"
import { tenantMrr } from "./logic"
import { requireStaff } from "./permissions"
import type { Plan, PlanLimits, PlatformSeed, StaffMember, TenantStatus } from "./types"
import { LIMITS } from "./types"

// The /platform/plans view model (Task 7), built on the server like tenants.ts. Plans and the module catalogue are
// catalogue facts (public prices); the tenants are only { id, plan, status } (no names), so counts and MRR per plan can
// follow a change made elsewhere in the session. `can.amounts` = billing.read (MRR per plan), `can.write` = plans.write.

export type PlanTenant = { id: string; plan: string; status: TenantStatus }
export type PlansData = {
  plans: Plan[]
  entitlements: EntitlementsData
  tenants: PlanTenant[]
  can: { amounts: boolean; write: boolean }
}

export function plansData(seed: PlatformSeed, op: StaffMember): PlansData {
  return {
    plans: seed.plans,
    entitlements: seed.entitlements,
    tenants: seed.tenants.map(({ id, plan, status }) => ({ id, plan, status })),
    can: { amounts: requireStaff(op, "billing.read"), write: requireStaff(op, "plans.write") },
  }
}

/** The plan forms' view model (/platform/plans/new and /[id]/edit, final review I1): the plan catalogue and its module
 *  entitlements only. No tenants, invoices, audit log or data requests reach those pages. */
export type PlanFormData = Pick<PlatformSeed, "plans" | "entitlements">
export const planFormData = (seed: Pick<PlatformSeed, "plans" | "entitlements">): PlanFormData => ({ plans: seed.plans, entitlements: seed.entitlements })

export type PlanStat = { tenants: number; mrr: number | null }

/** Tenants and MRR on each plan; MRR is null without billing.read. */
export function planStats(plans: Plan[], tenants: PlanTenant[], amounts: boolean): Record<string, PlanStat> {
  const out: Record<string, PlanStat> = {}
  for (const p of plans) {
    const on = tenants.filter((t) => t.plan === p.id)
    out[p.id] = { tenants: on.length, mrr: amounts ? on.reduce((s, t) => s + tenantMrr(t, plans), 0) : null }
  }
  return out
}

/** The plans a tenant can move to: none archived (the server flag, or `archivedNow` from this session's plans store),
 *  except the tenant's current plan, which stays listed so the form can show it. */
export function planChoices<P extends Pick<Plan, "id" | "archived">>(plans: P[], current: string, archivedNow: ReadonlySet<string>): P[] {
  return plans.filter((p) => !(p.archived || archivedNow.has(p.id)) || p.id === current)
}

/** Why a plan can't be archived, or null when it can. Any tenant on the plan (whatever its status) blocks it. */
export function archiveBlock(plan: Plan, tenants: Pick<PlanTenant, "plan">[], defaultPlan?: string): string | null {
  if (plan.archived) return "Already archived"
  const n = tenants.filter((t) => t.plan === plan.id).length
  if (n > 0) return `${n} ${n === 1 ? "tenant is" : "tenants are"} still on this plan`
  if (defaultPlan === plan.id) return "Used as the default plan for new sign-ups"
  return null
}
export const canArchive = (plan: Plan, tenants: Pick<PlanTenant, "plan">[], defaultPlan?: string) => archiveBlock(plan, tenants, defaultPlan) === null

// ---------- New plan ----------

export type NewPlanInput = { id: string; name: string; price: string; trialDays: string } & Record<keyof PlanLimits, string>
export type NewPlanErrors = Partial<Record<keyof NewPlanInput, string>>

export const PLAN_ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const TRIAL_DAYS_MAX = 90
export const TRIAL_LABEL = `Trial (0 to ${TRIAL_DAYS_MAX} days)`

/** Unique id (a slug), a name, a price of 0 or more, whole-number limits of at least 1 and a trial of 0 to 90 days. */
export function validateNewPlan(input: NewPlanInput, plans: Plan[], currency: string): { errors: NewPlanErrors; plan?: Plan } {
  const errors: NewPlanErrors = {}
  const id = input.id.trim().toLowerCase()
  const name = input.name.trim()
  if (!id) errors.id = "Enter an ID"
  else if (!PLAN_ID_RE.test(id)) errors.id = "Use lowercase letters, numbers and single hyphens, like team-plus"
  else if (plans.some((p) => p.id.toLowerCase() === id)) errors.id = "A plan with this ID already exists"
  if (!name) errors.name = "Enter a name"
  else if (plans.some((p) => p.name.toLowerCase() === name.toLowerCase())) errors.name = "A plan with this name already exists"
  if (!/^\d+(\.\d{1,2})?$/.test(input.price.trim())) errors.price = "Enter a price of 0 or more, like 149 or 149.50"
  if (!/^\d+$/.test(input.trialDays.trim()) || Number(input.trialDays) > TRIAL_DAYS_MAX) errors.trialDays = `Enter whole days from 0 to ${TRIAL_DAYS_MAX}`
  for (const l of LIMITS) {
    const v = input[l.key].trim()
    if (!/^\d+$/.test(v)) errors[l.key] = `${l.label}: enter a whole number`
    else if (Number(v) < 1) errors[l.key] = `${l.label} must be at least 1`
  }
  if (Object.keys(errors).length) return { errors }
  const limits = Object.fromEntries(LIMITS.map((l) => [l.key, Number(input[l.key])])) as PlanLimits
  return { errors, plan: { id, name, priceMonthly: Number(input.price), currency, trialDays: Number(input.trialDays), limits } }
}
