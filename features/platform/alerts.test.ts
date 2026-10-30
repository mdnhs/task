import { describe, expect, it } from "vitest"

import { platformAlerts } from "./alerts"
import type { PlatformTenant, SupportRequest } from "./types"

const tenant = (over: Partial<PlatformTenant>): PlatformTenant => ({
  id: "t", name: "T", slug: "t", subdomain: "t.x", plan: "p", status: "active", users: 1, storageGb: 1, messages: 1, transcriptionMinutes: 1,
  createdAt: "2026-01-01T00:00:00", contacts: [], billing: { paymentMethod: "" }, ...over,
})
const req = (over: Partial<SupportRequest>): SupportRequest =>
  ({ id: "SUP-1", tenantId: "a", requester: "R", reason: "x", status: "requested", requestedAt: "2026-10-20T08:00:00", expiresAt: null, grantedBy: null, ...over })

describe("platformAlerts", () => {
  const today = "2026-10-30T09:00"
  it("flags past-due tenants, pending support access and trials ending within 7 days", () => {
    const tenants = [
      tenant({ id: "a", name: "A", status: "past_due", billing: { paymentMethod: "", lastInvoice: { id: "i", at: "2026-10-14T00:00:00", paid: false } } }),
      tenant({ id: "b", name: "B", status: "trial", billing: { paymentMethod: "", trialEndsOn: "2026-11-04" } }),
      tenant({ id: "c", name: "C", status: "trial", billing: { paymentMethod: "", trialEndsOn: "2026-12-20" } }),
      tenant({ id: "d", name: "D", status: "active" }),
    ]
    const alerts = platformAlerts(tenants, [req({}), req({ id: "SUP-2", status: "granted" })], today)
    expect(alerts.map((a) => a.id).sort()).toEqual(["acc-SUP-1", "pay-a", "trial-b"])
    expect(alerts.find((a) => a.id === "acc-SUP-1")?.title).toContain("A")
    expect(alerts.every((a) => !a.read)).toBe(true)
  })
  it("is empty when nothing needs attention", () => {
    expect(platformAlerts([tenant({})], [], today)).toEqual([])
  })
})
