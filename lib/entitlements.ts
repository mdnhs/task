// Plan entitlements (FR-M0-15, AC-M0-05). Pure: the module map and plan table are data (billing/entitlements.json).
// A nav module belongs to one product module; a tenant sees it only if its plan includes that product module.
import { moduleForHref } from "./permissions"
import type { Module, Role } from "./types"

export type ProductModule = { id: string; label: string; description: string }
export type EntitlementsData = {
  productModules: ProductModule[]
  /** Nav module -> product module id. A module missing here is core and always included. */
  modules: Partial<Record<Module, string>>
  /** Product module id of the AI assistant (it has no route). */
  assistant: string
  defaultPlan: string
  /** Plan id -> product module ids the plan includes. */
  plans: Record<string, string[]>
  /** Product modules every tenant keeps: a per-tenant override can't revoke them. */
  core?: string[]
}
/** A per-tenant add-on grant or revoke on top of the plan (platform console, tenant 360 → Modules). */
export type ModuleOverride = { module: string; mode: "grant" | "revoke" }
export type TenantEntitlements = { planId: string; allowed: string[]; modules: EntitlementsData["modules"]; assistant: string }

/**
 * A tenant's effective product modules: the plan's modules ± its overrides, in catalogue order. Unknown module ids
 * are ignored, and a core module stays even when an override revokes it.
 */
export function effectiveModules(data: EntitlementsData, planId: string, overrides: readonly ModuleOverride[] | undefined): string[] {
  const set = new Set(data.plans[planId] ?? [])
  for (const o of overrides ?? []) {
    if (o.mode === "grant") set.add(o.module)
    else if (!data.core?.includes(o.module)) set.delete(o.module)
  }
  return data.productModules.map((p) => p.id).filter((id) => set.has(id))
}

/** Entitlements of a plan, plus the tenant's module overrides. An unknown plan id falls back to the default plan. */
export function resolveEntitlements(data: EntitlementsData, planId: string | undefined, overrides?: readonly ModuleOverride[]): TenantEntitlements {
  const id = planId && data.plans[planId] ? planId : data.defaultPlan
  const allowed = overrides?.length ? effectiveModules(data, id, overrides) : (data.plans[id] ?? [])
  return { planId: id, allowed, modules: data.modules, assistant: data.assistant }
}

export const hasProductModule = (ent: TenantEntitlements, id: string): boolean => ent.allowed.includes(id)

/** Whether the tenant's plan includes a nav module. */
export function hasModule(ent: TenantEntitlements, module: Module): boolean {
  const product = ent.modules[module]
  return !product || hasProductModule(ent, product)
}

/** Drops nav items (or search actions) whose module is not in the plan. */
export function filterByEntitlement<T extends { href: string }>(items: T[], ent: TenantEntitlements): T[] {
  return items.filter((n) => {
    const m = moduleForHref(n.href)
    return !m || hasModule(ent, m)
  })
}

/** Nav modules the plan does not include. */
export const missingModules = (ent: TenantEntitlements): Module[] => (Object.keys(ent.modules) as Module[]).filter((m) => !hasModule(ent, m))

/** The role with no access to modules outside the plan, so every can() check, nav, search and dashboard link follows the plan. */
export function restrictRole(role: Role, ent: TenantEntitlements): Role {
  const missing = missingModules(ent)
  if (missing.length === 0) return role
  const access = { ...role.access }
  for (const m of missing) access[m] = "none"
  return { ...role, access }
}

/**
 * Product modules of a plan, in catalogue order, each marked included or not (billing page, platform console).
 * With a tenant's overrides, `included` is the effective state, `inPlan` what the plan alone has and `override` the
 * override that applies to the module.
 */
export function planModules(
  data: EntitlementsData,
  planId: string,
  overrides?: readonly ModuleOverride[],
): (ProductModule & { included: boolean; inPlan: boolean; override?: ModuleOverride["mode"] })[] {
  const plan = data.plans[planId] ?? []
  const allowed = overrides?.length ? effectiveModules(data, planId, overrides) : plan
  return data.productModules.map((p) => {
    const o = overrides?.findLast((x) => x.module === p.id)?.mode
    return { ...p, included: allowed.includes(p.id), inPlan: plan.includes(p.id), ...(o ? { override: o } : {}) }
  })
}

/**
 * A copy of the entitlements with `planId` set to `ids` (platform plan editor). Unknown ids are dropped and the
 * list follows catalogue order, so entitlements.plans stays the one source of truth for what a plan includes.
 */
export function withPlanModules(data: EntitlementsData, planId: string, ids: string[]): EntitlementsData {
  const next = data.productModules.map((p) => p.id).filter((id) => ids.includes(id))
  return { ...data, plans: { ...data.plans, [planId]: next } }
}
