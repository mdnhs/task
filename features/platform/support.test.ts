import { describe, expect, it } from "vitest"

import { planFormData } from "./plans"
import { supportData } from "./support"
import type { PlatformSeed, StaffMember } from "./types"

// Final review I1: /platform/support and the plan forms get slim server view models, never the whole seed (D3).
const seed = {
  tenants: [
    { id: "t1", name: "Northgate", slug: "northgate", contacts: [{ role: "Admin", name: "Ann Admin", email: "ann@tenant.example" }], billing: { paymentMethod: "Visa •••• 4242" } },
  ],
  plans: [{ id: "business", name: "Business", priceMonthly: 149.5, currency: "EUR", trialDays: 14, limits: { activeUsers: 50, storageGb: 50, messages: 1, transcriptionMinutes: 1 } }],
  entitlements: { productModules: [{ id: "tasks", label: "Tasks" }], plans: { business: ["tasks"] } },
  requests: [{ id: "SUP-1", tenantId: "t1", requester: "Priya Shah", reason: "Login loop on the shift report", status: "requested", requestedAt: "2026-10-29T10:00:00", expiresAt: null, grantedBy: null }],
  audit: [
    { id: "PAU-2", at: "2026-10-29T10:00:00", actor: "Priya Shah", action: "support.requested", target: "Northgate", detail: "Support access requested", tenantId: "t1" },
    { id: "PAU-1", at: "2026-10-28T10:00:00", actor: "Ana", action: "billing.refunded", target: "Northgate", detail: "Refunded €987.65", staffRole: "billing", before: { status: "paid" }, after: { status: "refunded" }, reason: "Duplicate charge" },
  ],
  subscriptions: [{ id: "SUB-1", tenantId: "t1", at: "2026-01-01T10:00:00", kind: "start", plan: "business", mrrDelta: 4321 }],
  invoices: [{ id: "INV-77", tenantId: "t1", amount: 987.65, currency: "EUR" }],
  usage: { t1: [{ day: "2026-10-01", activeUsers: 33 }] },
  dataRequests: [{ id: "DSR-55", tenantId: "t1", kind: "export" }],
} as unknown as PlatformSeed
const op = (role: StaffMember["role"]): StaffMember => ({ id: "s", name: "Ana", email: "a@x", role, mfa: true, lastSignInAt: null, status: "active" })

// Nothing outside the page's needs, for any role: no invoices, amounts, MRR deltas, usage, data requests or contacts.
const NEVER = ["INV-77", "987", "4321", "mrrDelta", "DSR-55", "activeUsers", "Visa", "ann@tenant.example", "contacts", "priceMonthly"]

describe("supportData", () => {
  it("ships tenant names, the requests and nothing else from the seed, per role", () => {
    for (const role of ["owner", "support"] as const) {
      const d = supportData(seed, op(role))
      expect(Object.keys(d).sort()).toEqual(["audit", "requests", "tenants"])
      expect(d.tenants).toEqual([{ id: "t1", name: "Northgate" }])
      const json = JSON.stringify(d)
      for (const s of NEVER) expect(json).not.toContain(s)
    }
  })

  it("has no audit log without audit.read (support), so the card is hidden", () => {
    const d = supportData(seed, op("support"))
    expect(d.audit).toBeNull()
    expect(JSON.stringify(d)).not.toContain("PAU-")
  })

  it("with audit.read (owner), lists only support-access lines, without before/after or reason", () => {
    const d = supportData(seed, op("owner"))
    expect(d.audit?.map((e) => e.id)).toEqual(["PAU-2"])
    expect(Object.keys(d.audit![0]).sort()).toEqual(["action", "actor", "at", "detail", "id", "target"])
    const json = JSON.stringify(d)
    for (const s of ["PAU-1", "billing.refunded", "Duplicate charge", "€"]) expect(json).not.toContain(s)
  })
})

describe("planFormData", () => {
  // Owner and billing (plans.write) get the same catalogue: no tenants, invoices, MRR deltas, usage, audit or data requests.
  it("ships the plan catalogue and entitlements only", () => {
    const d = planFormData(seed)
    expect(Object.keys(d).sort()).toEqual(["entitlements", "plans"])
    const json = JSON.stringify(d)
    for (const s of ["INV-77", "987", "4321", "mrrDelta", "DSR-55", "PAU-", "Northgate", "SUP-1", "Visa", "2026-10-01"]) expect(json).not.toContain(s)
  })
})
