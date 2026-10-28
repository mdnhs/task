import { describe, expect, it } from "vitest"

import { effectiveStatus, filterTenants, formatLeft, reactivateTenant, summarize, suspendTenant, tenantMrr, EMPTY_FILTERS, isoSeconds } from "./logic"
import type { Plan, PlatformTenant, SupportRequest } from "./types"

const plans: Plan[] = [{ id: "p", name: "P", priceMonthly: 100, currency: "GBP", trialDays: 14, limits: { activeUsers: 1, storageGb: 1, messages: 1, transcriptionMinutes: 1 }, modules: [] }]
const tenant = (over: Partial<PlatformTenant> = {}): PlatformTenant => ({
  id: "t", name: "Acme Ltd", slug: "acme", subdomain: "acme.example.app", plan: "p", status: "active", users: 1, storageGb: 1, messages: 1,
  transcriptionMinutes: 1, createdAt: "2026-01-01T10:00:00", contacts: [], billing: { paymentMethod: "Card", renewsOn: "2026-11-01" }, ...over,
})

describe("mrr and summary", () => {
  it("counts active and past-due tenants only", () => {
    expect(tenantMrr(tenant(), plans)).toBe(100)
    expect(tenantMrr(tenant({ status: "past_due" }), plans)).toBe(100)
    expect(tenantMrr(tenant({ status: "trial" }), plans)).toBe(0)
    expect(tenantMrr(tenant({ status: "suspended" }), plans)).toBe(0)
  })
  it("summarizes", () => {
    const s = summarize([tenant(), tenant({ status: "trial" }), tenant({ status: "past_due" })], plans)
    expect(s).toEqual({ tenants: 3, mrr: 200, trials: 1, pastDue: 1 })
  })
})

describe("filterTenants", () => {
  it("filters by status, plan and search", () => {
    const rows = [tenant(), tenant({ id: "u", name: "Beta", slug: "beta", subdomain: "beta.example.app", status: "trial" })]
    expect(filterTenants(rows, { ...EMPTY_FILTERS, status: "trial" })).toHaveLength(1)
    expect(filterTenants(rows, { ...EMPTY_FILTERS, q: "ACME" })[0].id).toBe("t")
    expect(filterTenants(rows, { ...EMPTY_FILTERS, plan: "x" })).toHaveLength(0)
  })
})

describe("suspend and reactivate", () => {
  it("round-trips the status", () => {
    const s = suspendTenant(tenant(), "2026-10-20T09:00:00", "Non-payment")
    expect(s.status).toBe("suspended")
    const r = reactivateTenant(s)
    expect(r.status).toBe("active")
    expect(r.suspendedAt).toBeUndefined()
  })
  it("resumes a trial that never paid as a trial", () => {
    expect(reactivateTenant(tenant({ status: "suspended", billing: { paymentMethod: "None", trialEndsOn: "2026-11-01" } })).status).toBe("trial")
  })
})

describe("support access expiry", () => {
  const req = (over: Partial<SupportRequest> = {}): SupportRequest => ({ id: "SUP-1", tenantId: "t", requester: "x", reason: "r", status: "granted", requestedAt: "2026-10-20T08:00:00", expiresAt: "2026-10-20T12:00:00", grantedBy: "y", ...over })
  it("turns a lapsed grant into expired", () => {
    expect(effectiveStatus(req(), isoSeconds("2026-10-20T11:59:59"))).toBe("granted")
    expect(effectiveStatus(req(), isoSeconds("2026-10-20T12:00:00"))).toBe("expired")
    expect(effectiveStatus(req({ status: "revoked" }), isoSeconds("2026-10-21T00:00:00"))).toBe("revoked")
  })
  it("formats the time left", () => {
    expect(formatLeft(3 * 3600 + 5 * 60 + 9)).toBe("03:05:09")
    expect(formatLeft(86400 + 60)).toBe("1d 00:01:00")
    expect(formatLeft(0)).toBeNull()
  })
})
