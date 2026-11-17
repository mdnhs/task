// Server side of billing (B6 T6.4). The subscription and invoices come from the API; the plan table and the module map stay static (structure, not tenant data).
import { ApiError } from "@/lib/api/problem"
import type { ApiClient } from "@/lib/api/client"
import { apiServer } from "@/lib/api/server"
import { getData } from "@/lib/data"
import type { EntitlementsData } from "@/lib/entitlements"
import { toInvoice, toSubscription } from "./adapters"
import { INVOICES_FETCH_LIMIT } from "./constants"
import type { Invoice, Plan, Subscription } from "./types"

/** Module map and per-plan entitlements (FR-M0-15). Static: also what the loading skeletons read. */
export const getEntitlements = async () => getData<EntitlementsData>("billing/entitlements.json")

/** The plan table (display only; the API holds the same facts). Static. */
export const getPlans = async () => getData<Plan[]>("billing/plans.json")

export type BillingData = { subscription: Subscription; invoices: Invoice[]; invoicesMore: boolean }

/** Subscription plus the newest invoices (one page of up to 100, paged in the browser). Owner or admin only: the API answers anyone else 403. */
export async function loadBilling(api: Pick<ApiClient, "get">): Promise<BillingData> {
  const [sub, inv] = await Promise.all([api.get("/v1/billing/subscription"), api.get("/v1/billing/invoices", { query: { limit: INVOICES_FETCH_LIMIT } })])
  return { subscription: toSubscription(sub), invoices: inv.items.map(toInvoice), invoicesMore: inv.nextCursor !== null }
}

/** The billing tab's data, or null when the caller is not allowed to see it (403) or the company has no subscription row (404). Any other failure is thrown. */
export async function getBilling(): Promise<BillingData | null> {
  try {
    return await loadBilling(await apiServer())
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null
    throw e
  }
}

/** Seat cap (FR-SAAS-06): the tenant's own cap from /v1/entitlements (open to every member) and the name of its plan from the static table. */
export async function getSeatLimit(): Promise<{ limit: number; planName: string }> {
  const [ent, plans] = await Promise.all([(await apiServer()).get("/v1/entitlements"), getPlans()])
  return { limit: ent.seats, planName: plans.find((p) => p.id === ent.planId)?.name ?? ent.planId }
}
