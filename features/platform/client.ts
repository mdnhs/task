// The console's writes (B6 T6.8): every one is ONE call to the API through the BFF. The rules the API checks with 422 are checked here first, so a bad value never leaves the page:
// a reason is 1 to 500 characters (trimmed), trial days are whole numbers 1 to 30, a support grant is 1 to 24 whole hours.
import type { ApiClient } from "@/lib/api/client"

export const REASON_MAX = 500
export const TRIAL_DAYS_MAX = 30
export const GRANT_HOURS_MAX = 24

/** A value the API would refuse; thrown before any request. `field` names it for the form. */
export class PlatformInputError extends Error {
  constructor(readonly field: "reason" | "days" | "hours" | "email" | "role", message: string) {
    super(message)
    this.name = "PlatformInputError"
  }
}

export function checkReason(reason: string): string {
  const r = reason.trim()
  if (r.length < 1 || r.length > REASON_MAX) throw new PlatformInputError("reason", `Give a reason of 1 to ${REASON_MAX} characters.`)
  return r
}
const whole = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max

export type ModuleOverride = { module: string; mode: "grant" | "revoke" }

export function makePlatformClient(api: ApiClient) {
  const tid = (tenantId: string) => ({ tenantId })
  return {
    suspend: async (tenantId: string, reason: string) => api.post("/v1/platform/tenants/{tenantId}/suspend", { path: tid(tenantId), body: { reason: checkReason(reason) } }),
    reactivate: async (tenantId: string, reason: string) => api.post("/v1/platform/tenants/{tenantId}/reactivate", { path: tid(tenantId), body: { reason: checkReason(reason) } }),
    async extendTrial(tenantId: string, days: number, reason: string) {
      if (!whole(days, 1, TRIAL_DAYS_MAX)) throw new PlatformInputError("days", `Days must be a whole number from 1 to ${TRIAL_DAYS_MAX}.`)
      return api.post("/v1/platform/tenants/{tenantId}/extend-trial", { path: tid(tenantId), body: { days, reason: checkReason(reason) } })
    },
    /** `overrides` is the FULL list: the API replaces the tenant's overrides with it (unlisted ones are cleared). */
    setModules: async (tenantId: string, overrides: ModuleOverride[], reason: string) =>
      api.put("/v1/platform/tenants/{tenantId}/modules", { path: tid(tenantId), body: { overrides, reason: checkReason(reason) } }),
    async createGrant(tenantId: string, reason: string, hours: number) {
      if (!whole(hours, 1, GRANT_HOURS_MAX)) throw new PlatformInputError("hours", `Hours must be a whole number from 1 to ${GRANT_HOURS_MAX}.`)
      return api.post("/v1/platform/tenants/{tenantId}/support-grants", { path: tid(tenantId), body: { reason: checkReason(reason), hours } })
    },
    revokeGrant: (id: string) => api.delete("/v1/platform/support-grants/{id}", { path: { id } }),
    async addStaff(email: string, role: "owner" | "support" | "billing" | "viewer") {
      const e = email.trim()
      if (!e.includes("@") || e.length > 320) throw new PlatformInputError("email", "Enter the person's email.")
      return api.post("/v1/platform/staff", { body: { email: e, role } })
    },
    patchStaff: (userId: string, patch: { role?: "owner" | "support" | "billing" | "viewer"; status?: "active" | "suspended" }) => api.patch("/v1/platform/staff/{userId}", { path: { userId }, body: patch }),
    /** An empty `apiKey` is left out, so the stored key stays. */
    saveEmail: (f: { apiKey?: string; fromAddress: string; fromName: string }) => api.put("/v1/platform/settings/email", { body: { fromAddress: f.fromAddress.trim(), fromName: f.fromName.trim(), ...(f.apiKey?.trim() ? { apiKey: f.apiKey.trim() } : {}) } }),
    testEmail: (to: string) => api.post("/v1/platform/settings/email/test", { body: { to: to.trim() } }),
    saveStorage: (f: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey?: string }) =>
      api.put("/v1/platform/settings/storage", { body: { accountId: f.accountId.trim(), bucket: f.bucket.trim(), accessKeyId: f.accessKeyId.trim(), ...(f.secretAccessKey?.trim() ? { secretAccessKey: f.secretAccessKey.trim() } : {}) } }),
    testStorage: () => api.post("/v1/platform/settings/storage/test"),
    saveBilling: (f: { secretKey?: string; webhookSecret?: string; publishableKey: string | null }) =>
      api.put("/v1/platform/settings/billing", { body: { publishableKey: f.publishableKey?.trim() || null, ...(f.secretKey?.trim() ? { secretKey: f.secretKey.trim() } : {}), ...(f.webhookSecret?.trim() ? { webhookSecret: f.webhookSecret.trim() } : {}) } }),
  }
}
export type PlatformClient = ReturnType<typeof makePlatformClient>
