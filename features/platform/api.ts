import { getData } from "@/lib/data"
import { getSupportAccess } from "@/lib/support-data"
import type { NavigationData } from "@/features/shell"
import type { AuditEntry, Plan, PlatformSeed, PlatformTenant} from "./types"

export const getPlatformNav = () => getData<NavigationData>("platform/navigation.json")

// Plans are the billing module's seed: read the JSON, never import features/billing.
export async function getPlatformSeed(): Promise<PlatformSeed> {
  const [{ tenants }, plans, requests, { entries }] = await Promise.all([
    getData<{ tenants: PlatformTenant[] }>("platform/tenants.json"),
    getData<Plan[]>("billing/plans.json"),
    getSupportAccess(),
    getData<{ entries: AuditEntry[] }>("platform/audit.json"),
  ])
  return { tenants, plans, requests, audit: entries }
}
