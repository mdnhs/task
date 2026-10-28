import { createStore } from "@/lib/store"
import { useSupportAccess } from "@/hooks/use-support-access"
import type { AuditEntry, Plan, PlatformSeed, PlatformTenant } from "./types"

export const tenantsStore = createStore<PlatformTenant[]>()
export const plansStore = createStore<Plan[]>()
export { supportStore as requestsStore } from "@/hooks/use-support-access"
export const auditStore = createStore<AuditEntry[]>()

const SCOPE = "platform"

// Every platform page seeds all four stores, so an edit on one page shows up on the others after client navigation.
export function usePlatform(seed: PlatformSeed) {
  const [tenants, setTenants] = tenantsStore.useStore(seed.tenants, SCOPE)
  const [plans, setPlans] = plansStore.useStore(seed.plans, SCOPE)
  const [requests, setRequests] = useSupportAccess(seed.requests)
  const [audit, setAudit] = auditStore.useStore(seed.audit, SCOPE)
  return { tenants, setTenants, plans, setPlans, requests, setRequests, audit, setAudit }
}
