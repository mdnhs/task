// Server-only reads for plan entitlements. The pure logic lives in lib/entitlements.ts.
// The tenant's own entitlements come from the API (GET /v1/entitlements) and are NEVER cached by the app: every read goes to the API (which caches 60 s itself).
// apiServer() sends cache: "no-store", and nothing in this file opts into any Next cache.
import type { ApiClient } from "./api/client"
import { getData } from "./data"
import { toTenantEntitlements, type EntitlementsData, type TenantEntitlements } from "./entitlements"

export const getEntitlementsData = () => getData<EntitlementsData>("billing/entitlements.json")

export async function loadTenantEntitlements(api: Pick<ApiClient, "get">, data: () => Promise<EntitlementsData> = getEntitlementsData): Promise<TenantEntitlements> {
  const [ent, table] = await Promise.all([api.get("/v1/entitlements"), data()])
  return toTenantEntitlements(ent, table)
}

/** The caller's tenant entitlements, fresh on every call. */
export async function getTenantEntitlements(): Promise<TenantEntitlements> {
  const { apiServer } = await import("./api/server") // lazy: "server-only" stays out of the pure tests
  return loadTenantEntitlements(await apiServer())
}
