// Server side of the platform console (B6 T6.8): the staff API through apiServer. Loaders take a client (Pick<ApiClient,"get">) so the contract tests run them against the real API.
// The operator is the signed-in user (/v1/me.platformRole), never a seed. Pages call gate() (app/(platform)/gate.tsx) before any loader.
import type { ApiClient } from "@/lib/api/client"
import { ApiError } from "@/lib/api/problem"
import { getPlatformSession } from "@/lib/session"
import { billingMode, toAuditLines, toGrants, toBillingSettings, toDataRequests, toEmailSettings, toMetrics, toStaffRows, toStorageSettings, toTenant360, toTenantList } from "./adapters"
import type { StaffMember } from "./types"

type Reader = Pick<ApiClient, "get">

/** The signed-in staff member, or null when the caller is not active platform staff (the pages then show "Access restricted"). */
export async function getOperator(): Promise<StaffMember | null> {
  const s = await getPlatformSession()
  if (!s.platformRole) return null
  return { id: s.user.id, name: s.user.name, email: s.user.email, role: s.platformRole, mfa: s.twoFactorEnabled, lastSignInAt: null, status: "active" }
}

export const TENANTS_PAGE = 100

export async function loadTenantList(api: Reader, o: { q?: string; status?: "active" | "suspended"; plan?: string; page?: number; pageSize?: number } = {}) {
  return toTenantList(await api.get("/v1/platform/tenants", { query: { ...(o.q ? { q: o.q } : {}), ...(o.status ? { status: o.status } : {}), ...(o.plan ? { plan: o.plan } : {}), page: o.page ?? 1, pageSize: o.pageSize ?? TENANTS_PAGE } }))
}

/** null for an unknown tenant (404 tenant_not_found): the page shows "Tenant not found". */
export async function loadTenant360(api: Reader, id: string) {
  try {
    return toTenant360(await api.get("/v1/platform/tenants/{tenantId}", { path: { tenantId: id } }))
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && e.code === "tenant_not_found") return null
    throw e
  }
}

export const loadMetrics = async (api: Reader) => toMetrics(await api.get("/v1/platform/metrics"))
export const loadAudit = async (api: Reader, o: { targetTenantId?: string; entity?: string; limit?: number } = {}) =>
  toAuditLines(await api.get("/v1/platform/audit", { query: { ...(o.targetTenantId ? { targetTenantId: o.targetTenantId } : {}), ...(o.entity ? { entity: o.entity } : {}), limit: o.limit ?? 200 } }))
export const loadDataRequests = async (api: Reader, page = 1) => toDataRequests(await api.get("/v1/platform/data-requests", { query: { page, pageSize: 100 } }))
export const GRANTS_PAGE = 50
/** The newest grants across tenants (every status), for the support page; `tenantId` narrows it to one tenant. */
export const loadSupportGrants = async (api: Reader, o: { tenantId?: string; status?: "active" | "expired" | "revoked"; cursor?: string } = {}) =>
  toGrants(await api.get("/v1/platform/support-grants", { query: { ...(o.tenantId ? { tenantId: o.tenantId } : {}), ...(o.status ? { status: o.status } : {}), ...(o.cursor ? { cursor: o.cursor } : {}), limit: GRANTS_PAGE } }))
export const loadStaff = async (api: Reader) => toStaffRows(await api.get("/v1/platform/staff"))
export async function loadSettings(api: Reader) {
  const [email, storage, billing] = await Promise.all([api.get("/v1/platform/settings/email"), api.get("/v1/platform/settings/storage"), api.get("/v1/platform/settings/billing")])
  return { email: toEmailSettings(email), storage: toStorageSettings(storage), billing: toBillingSettings(billing) }
}
/** The topbar pill (owner only: the settings routes are owner-only). null for every other role or when the mode is unknown. */
export async function loadEnv(api: Reader): Promise<{ label: string; live: boolean } | null> {
  try {
    return billingMode(await api.get("/v1/platform/settings/billing"))
  } catch (e) {
    if (e instanceof ApiError && (e.status === 403 || e.status === 404)) return null
    throw e
  }
}
