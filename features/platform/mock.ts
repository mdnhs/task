// MOCK (B6 ruling I16): the seed readers of the console's UNBACKED pages (plans, invoice ledger, usage, notes, change plan, schedule deletion, the MRR history). They read
// public/data/platform/*.json and are shown only with ENABLE_MOCK_MODULES=1. Everything backed by the staff API is in ./api.ts.
import { getData } from "@/lib/data"
import { getEntitlementsData } from "@/lib/entitlements-data"
import { mockEnabled } from "@/lib/mock-registry"
import type { NavigationData } from "@/lib/types"
import type { AuditEntry, DataRequest, Invoice, Plan, PlatformSeed, PlatformSettings, PlatformTenant, SubEvent, UsagePoint } from "./types"

/** The console navigation: entries whose page has no API behind it (the unbacked set) are listed only on a demo deployment. */
export const UNBACKED_PATHS = ["/platform/billing", "/platform/plans"]
export async function getPlatformNav(): Promise<NavigationData> {
  const nav = await getData<NavigationData>("platform/navigation.json")
  return mockEnabled() ? nav : { ...nav, menu: nav.menu.filter((i) => !UNBACKED_PATHS.includes(i.href)) }
}

// Plans are the billing module's seed: read the JSON, never import features/billing.
export async function getPlatformSeed(): Promise<PlatformSeed> {
  const [{ tenants }, plans, entitlements, { entries }, { events }, { invoices }, { usage }, { requests: dataRequests }] = await Promise.all([
    getData<{ tenants: PlatformTenant[] }>("platform/tenants.json"),
    getData<Plan[]>("billing/plans.json"),
    getEntitlementsData(),
    getData<{ entries: AuditEntry[] }>("platform/audit.json"),
    getData<{ events: SubEvent[] }>("platform/subscriptions.json"),
    getData<{ invoices: Invoice[] }>("platform/invoices.json"),
    getData<{ usage: Record<string, UsagePoint[]> }>("platform/usage.json"),
    getData<{ requests: DataRequest[] }>("platform/data-requests.json"),
  ])
  // support access is the API's now (grants): the mock seed holds none
  return { tenants, plans, entitlements, requests: [], audit: entries, subscriptions: events, invoices, usage, dataRequests }
}

export const getPlatformSettings = () => getData<PlatformSettings>("platform/settings.json")
