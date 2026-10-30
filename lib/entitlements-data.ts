// Server-only reads for plan entitlements. The pure logic lives in lib/entitlements.ts.
import { getData } from "./data"
import { resolveEntitlements, type EntitlementsData, type ModuleOverride, type TenantEntitlements } from "./entitlements"

export const getEntitlementsData = () => getData<EntitlementsData>("billing/entitlements.json")

/** The tenant's entitlements: its subscription plan ± any module overrides set in the platform console. Checked per request. */
export async function getTenantEntitlements(tenantId: string): Promise<TenantEntitlements> {
  const [data, sub] = await Promise.all([
    getEntitlementsData(),
    getData<{ tenants: Record<string, { planId: string; moduleOverrides?: ModuleOverride[] }> }>("billing/subscription.json"),
  ])
  return resolveEntitlements(data, sub.tenants[tenantId]?.planId, sub.tenants[tenantId]?.moduleOverrides)
}
