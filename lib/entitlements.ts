import type { EntitlementsData, TenantEntitlements } from "@opsdesk/domain/entitlements"

export * from "@opsdesk/domain/entitlements"

/**
 * GET /v1/entitlements as the UI's TenantEntitlements: the API's `modules` list is the truth (plan plus the tenant's overrides), mapped to nav
 * modules through the static module table (structure, not tenant data). Nothing is defaulted: a missing list is an error, never "everything".
 */
export function toTenantEntitlements(ent: { planId: string; modules: string[] }, data: EntitlementsData): TenantEntitlements {
  if (typeof ent.planId !== "string" || !Array.isArray(ent.modules)) throw new Error("entitlements: planId and modules are required")
  return { planId: ent.planId, allowed: ent.modules, modules: data.modules, assistant: data.assistant }
}
