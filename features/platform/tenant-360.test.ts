import { describe, expect, it } from "vitest"

import { tenantDiff } from "./patches"
import { billingTab, moduleAction, settingsTab, tabsFor, tenant360Head, usageSeries } from "./tenant-360"
import type { Invoice, PlatformSeed, PlatformTenant, StaffMember, UsagePoint } from "./types"

const tenant = (over: Partial<PlatformTenant> = {}): PlatformTenant => ({
  id: "t1", name: "Acme", slug: "acme", subdomain: "acme.example.app", plan: "business", status: "past_due", users: 5, storageGb: 2, messages: 10,
  transcriptionMinutes: 1, createdAt: "2026-01-01T10:00:00", contacts: [], billing: { paymentMethod: "Card ending 4242", renewsOn: "2026-11-01", lastInvoice: { id: "I", at: "2026-10-01T08:00:00", paid: false } },
  creditBalance: 20, ...over,
})
const inv = (id: string, status: Invoice["status"], issuedAt: string, tenantId = "t1"): Invoice => ({
  id, tenantId, number: id, issuedAt, dueAt: issuedAt, amount: 149, currency: "EUR", status, attempts: 1, nextRetryAt: null, lines: [],
})
const seed = (tenants: PlatformTenant[], invoices: Invoice[] = []): PlatformSeed => ({
  tenants,
  plans: [{ id: "business", name: "Business", priceMonthly: 149, currency: "EUR", trialDays: 14, limits: { activeUsers: 40, storageGb: 50, messages: 5000, transcriptionMinutes: 600 } }],
  entitlements: { productModules: [], modules: {}, assistant: "M2", defaultPlan: "business", plans: { business: [] } },
  requests: [], audit: [], invoices, usage: {},
  subscriptions: [{ id: "SUB-31", tenantId: "t9", at: "2026-01-01T09:00:00", kind: "start", plan: "business", mrrDelta: 149 }],
  dataRequests: [{ id: "DSR-6", tenantId: "t9", kind: "export", subject: "tenant", requestedBy: "x", requestedAt: "2026-10-01T09:00:00", dueAt: "2026-10-31T09:00:00", status: "received", note: "" }],
})
const op = (role: StaffMember["role"]): StaffMember => ({ id: "s", name: "Op", email: "", role, mfa: true, lastSignInAt: null, status: "active" })
const PAY = { provider: "Stripe", mode: "test" }

describe("tenant360Head", () => {
  const s = seed([tenant()], [inv("A", "paid", "2026-08-01T08:00:00"), inv("B", "failed", "2026-09-01T08:00:00"), inv("C", "open", "2026-10-01T08:00:00"), inv("X", "failed", "2026-10-01T08:00:00", "t2")])
  it("returns null for an unknown id", () => {
    expect(tenant360Head(s, "nope", op("owner"), PAY)).toBeNull()
  })
  it("gives billing roles the unpaid invoices newest first and platform-wide id floors", () => {
    const h = tenant360Head(s, "t1", op("billing"), PAY)!
    expect(h.unpaid.map((i) => i.id)).toEqual(["C", "B"])
    expect(h.ids).toEqual({ sub: "SUB-31", dsr: "DSR-6" })
    expect(h.can).toMatchObject({ amounts: true, billing: true, suspend: false, lifecycle: false, notes: true })
    expect(h.health.past_due?.reasons).toContain("Payment past due")
  })
  it("sends no amounts or payment details to a role without billing.read (D3)", () => {
    const h = tenant360Head(s, "t1", op("support"), PAY)!
    expect(h.unpaid).toEqual([])
    expect(h.plans[0]).toMatchObject({ priceMonthly: null, currency: "" })
    expect(h.tenant.billing).toEqual({ paymentMethod: "", renewsOn: "2026-11-01" })
    expect(h.tenant.creditBalance).toBeUndefined()
    expect(JSON.stringify(h)).not.toMatch(/149|4242/)
    expect(h.can).toMatchObject({ amounts: false, billing: false, support: true, dataRequests: true })
  })
  it("support can't open the billing or audit tabs; the viewer can", () => {
    expect(tabsFor(op("support"))).toEqual(["overview", "usage", "modules", "support", "settings"])
    expect(tabsFor(op("viewer"))).toEqual(["overview", "billing", "usage", "modules", "support", "audit", "settings"])
  })
})

describe("tab slices", () => {
  it("billing: an empty list for a tenant with no invoices (Review Focus 1)", () => {
    expect(billingTab(seed([tenant({ status: "trial" })]), tenant()).invoices).toEqual([])
  })
  it("settings: other tenants' slugs and this tenant's own data requests", () => {
    const s = seed([tenant(), tenant({ id: "t9", slug: "nine" })])
    expect(settingsTab(s, s.tenants[0], 90)).toEqual({ retentionDays: 90, takenSlugs: ["nine"], dataRequests: [] })
    expect(settingsTab(s, s.tenants[1], 90).dataRequests.map((r) => r.id)).toEqual(["DSR-6"])
  })
})

describe("usageSeries", () => {
  const p = (date: string, messages: number, activeUsers = 3): UsagePoint => ({ date, activeUsers, storageGb: 1, messages, transcriptionMinutes: 0 })
  const pts = [p("2026-09-29", 5), p("2026-09-30", 7, 4), p("2026-10-01", 2), p("2026-10-02", 3)]
  it("plots levels as the day's value", () => {
    expect(usageSeries(pts, "activeUsers").map((x) => x.value)).toEqual([3, 4, 3, 3])
  })
  it("plots monthly allowances month to date, resetting on the 1st", () => {
    expect(usageSeries(pts, "messages").map((x) => x.value)).toEqual([5, 12, 2, 5])
  })
})

describe("tenantDiff", () => {
  it("lists only changed fields, removed ones as undefined", () => {
    const a = tenant({ deletionAt: "2027-01-01" })
    const b = { ...tenant({ plan: "starter" }) }
    expect(tenantDiff(a, b)).toEqual({ patch: { plan: "starter", deletionAt: undefined }, before: { plan: "business", deletionAt: "2027-01-01" }, after: { plan: "starter", deletionAt: null } })
  })
})

describe("moduleAction (fix round 1: no revoke control for core modules)", () => {
  it("offers no revoke for a core module in the plan, revoke for others, grant outside the plan, reset for an override", () => {
    expect(moduleAction({ inPlan: true }, true)).toBeUndefined()
    expect(moduleAction({ inPlan: true }, false)).toBe("revoke")
    expect(moduleAction({ inPlan: false }, false)).toBe("grant")
    expect(moduleAction({ inPlan: false, override: "grant" }, false)).toBeNull()
  })
})
