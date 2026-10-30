import { describe, expect, it } from "vitest"

import { EMPTY_FILTERS, filterTenants, sortTenants, viewCounts } from "./logic"
import { liveRows, tenantsData } from "./tenants"
import { applyPatches, foldAudit } from "./patches"
import { sensitiveEntry } from "./logic"
import type { AuditEntry, Health, PlatformSeed, PlatformTenant, StaffMember, TenantRow } from "./types"

const health = (score: number): Health => ({ score, band: score >= 70 ? "healthy" : score >= 40 ? "watch" : "at_risk", reasons: [] })
const row = (over: Partial<TenantRow> = {}): TenantRow => ({
  id: "t", name: "Acme", slug: "acme", subdomain: "acme.example.app", plan: "starter", status: "active", users: 1, storageGb: 1,
  createdAt: "2026-01-01T10:00:00", mrr: 49, health: health(90), seatPct: 10, ...over,
})

const rows: TenantRow[] = [
  row({ id: "t1", name: "Northgate", plan: "business", mrr: 149, health: health(85) }),
  row({ id: "t10", name: "Marlowe", plan: "enterprise", status: "past_due", mrr: 399, health: health(30) }),
  row({ id: "t2", name: "Harbourline", status: "trial", mrr: 0, health: health(100) }),
  row({ id: "t5", name: "Canary Wharf", plan: "enterprise", mrr: 399, health: health(95) }),
  row({ id: "t8", name: "Kestrel", status: "suspended", mrr: 0, health: health(50) }),
]
const names = (r: TenantRow[]) => r.map((x) => x.name)

describe("sortTenants", () => {
  it("MRR desc puts the enterprise tenants first and ties keep name order", () => {
    expect(names(sortTenants(rows, { key: "mrr", dir: "desc" }))).toEqual(["Canary Wharf", "Marlowe", "Northgate", "Harbourline", "Kestrel"])
  })
  it("ties keep name order in ascending sorts too", () => {
    expect(names(sortTenants(rows, { key: "mrr", dir: "asc" }))).toEqual(["Harbourline", "Kestrel", "Northgate", "Canary Wharf", "Marlowe"])
  })
  it("sorts by name, health and created, without changing the input", () => {
    const before = names(rows)
    expect(names(sortTenants(rows, { key: "name", dir: "asc" }))[0]).toBe("Canary Wharf")
    expect(names(sortTenants(rows, { key: "health", dir: "asc" }))[0]).toBe("Marlowe")
    expect(names(rows)).toEqual(before)
  })
  it("orders plans by plan rank (the plans list order), not by name", () => {
    const ranked = rows.map((r) => ({ ...r, planRank: ["starter", "business", "enterprise"].indexOf(r.plan) }))
    expect(sortTenants(ranked, { key: "plan", dir: "desc" }).map((r) => r.plan).slice(0, 2)).toEqual(["enterprise", "enterprise"])
  })
})

describe("saved views", () => {
  it("past_due shows only past-due rows", () => {
    expect(names(filterTenants(rows, { ...EMPTY_FILTERS, view: "past_due" }))).toEqual(["Marlowe"])
  })
  it("at_risk follows the health band, trials and suspended follow the status", () => {
    expect(names(filterTenants(rows, { ...EMPTY_FILTERS, view: "at_risk" }))).toEqual(["Marlowe"])
    expect(names(filterTenants(rows, { ...EMPTY_FILTERS, view: "trial" }))).toEqual(["Harbourline"])
    expect(names(filterTenants(rows, { ...EMPTY_FILTERS, view: "suspended" }))).toEqual(["Kestrel"])
  })
  it("counts every view", () => {
    expect(viewCounts(rows)).toEqual({ all: 5, trial: 1, past_due: 1, at_risk: 1, suspended: 1 })
  })
  it("searches the id too", () => {
    expect(names(filterTenants(rows, { ...EMPTY_FILTERS, q: "t10" }))).toEqual(["Marlowe"])
  })
})

describe("tenantsData", () => {
  const plans = [
    { id: "starter", name: "Starter", priceMonthly: 49, currency: "EUR", trialDays: 14, limits: { activeUsers: 10, storageGb: 10, messages: 1, transcriptionMinutes: 1 } },
    { id: "enterprise", name: "Enterprise", priceMonthly: 399, currency: "EUR", trialDays: 14, limits: { activeUsers: 150, storageGb: 250, messages: 1, transcriptionMinutes: 1 } },
  ]
  const full = (over: Partial<PlatformTenant>): PlatformTenant => ({
    id: "t", name: "T", slug: "t", subdomain: "t.example.app", plan: "starter", status: "active", users: 1, storageGb: 1, messages: 40,
    transcriptionMinutes: 5, createdAt: "2026-01-01T10:00:00", contacts: [{ role: "Admin", name: "Ann Admin", email: "ann@tenant.example" }],
    billing: { paymentMethod: "Visa •••• 4242", renewsOn: "2026-11-01", lastInvoice: { id: "INV-1", at: "2026-10-01", paid: true } }, ...over,
  })
  const tenants: PlatformTenant[] = [full({ id: "a", name: "A", plan: "enterprise", users: 75 }), full({ id: "b", name: "B", status: "trial", billing: { paymentMethod: "", trialEndsOn: "2026-11-01" } })]
  const seed = { tenants, plans, requests: [], audit: [{ id: "PAU-1", at: "2026-10-01T09:00:00", actor: "x", action: "a", target: "A", detail: "d" }], subscriptions: [], invoices: [], usage: {}, dataRequests: [] } as unknown as PlatformSeed
  const op = (role: StaffMember["role"]): StaffMember => ({ id: "s", name: "Ana", email: "a@x", role, mfa: true, lastSignInAt: null, status: "active" })

  it("carries MRR for billing roles, per status, and the seat use", () => {
    const d = tenantsData(seed, op("owner"))
    expect(d.can).toEqual({ amounts: true, suspend: true, support: true })
    expect(d.derived.a.byStatus.active?.mrr).toBe(399)
    expect(d.derived.a.byStatus.suspended?.mrr).toBe(0)
    expect(d.derived.a.byStatus.suspended?.health.reasons).toContain("Suspended")
    const live = liveRows(seed.tenants, d.derived)
    expect(live.map((r) => [r.id, r.mrr, r.seatPct, r.planName])).toEqual([["a", 399, 50, "Enterprise"], ["b", 0, 10, "Starter"]])
    // After a suspend in the store, the row picks the suspended facts.
    expect(liveRows([{ ...seed.tenants[0], status: "suspended" }], d.derived)[0]).toMatchObject({ mrr: 0, health: { reasons: expect.arrayContaining(["Suspended"]) } })
    expect(d.derived.a.reactivatesAs).toBe("active")
    expect(d.derived.b.reactivatesAs).toBe("trial")
  })

  it("has no amount anywhere for a role without billing.read", () => {
    const d = tenantsData(seed, op("support"))
    expect(d.can).toEqual({ amounts: false, suspend: false, support: true })
    expect(Object.values(d.derived).flatMap((x) => Object.values(x.byStatus)).every((s) => s?.mrr === null)).toBe(true)
    expect(JSON.stringify(d)).not.toMatch(/399|priceMonthly/)
  })

  it("ships slim rows only: no billing, contacts, counters or audit log, for any role", () => {
    for (const role of ["support", "viewer", "owner"] as const) {
      const d = tenantsData(seed, op(role))
      expect(Object.keys(d.tenants[0]).sort()).toEqual(["createdAt", "id", "name", "plan", "slug", "status", "storageGb", "subdomain", "users"])
      expect(d).not.toHaveProperty("audit")
    }
    const json = JSON.stringify(tenantsData(seed, op("support")))
    for (const s of ["paymentMethod", "email", "billing", "€", "Visa", "contacts", "messages", "INV-1", "PAU-1"]) expect(json).not.toContain(s)
  })

  it("keeps the suspend fields a row needs", () => {
    const d = tenantsData({ ...seed, tenants: [full({ id: "s", status: "suspended", suspendedAt: "2026-10-01T09:00:00", suspendReason: "Non-payment" })] }, op("owner"))
    expect(d.tenants[0]).toMatchObject({ status: "suspended", suspendedAt: "2026-10-01T09:00:00", suspendReason: "Non-payment" })
  })
})

describe("patch model", () => {
  const t = (over: Partial<PlatformTenant> = {}) => ({ id: "a", status: "active" as const, ...over })
  it("applies patches by id and removes fields set to undefined", () => {
    const rows = [t({ id: "a" }), t({ id: "b", status: "suspended", suspendedAt: "x", suspendReason: "y" })]
    const out = applyPatches(rows, { a: { status: "suspended", suspendedAt: "2026-10-30T09:00:00", suspendReason: "Fraud check" }, b: { status: "trial", suspendedAt: undefined, suspendReason: undefined } })
    expect(out[0]).toEqual({ id: "a", status: "suspended", suspendedAt: "2026-10-30T09:00:00", suspendReason: "Fraud check" })
    expect(out[1]).toEqual({ id: "b", status: "trial" })
    expect(applyPatches(rows, {})).toBe(rows)
  })
  it("folds outbox entries into the log newest first with fresh ids", () => {
    const log: AuditEntry[] = [{ id: "PAU-7", at: "a", actor: "x", action: "y", target: "z", detail: "d" }]
    const outbox: AuditEntry[] = [{ ...log[0], id: "PAU-1", action: "second" }, { ...log[0], id: "PAU-1", action: "first" }]
    expect(foldAudit(log, outbox).map((e) => [e.id, e.action])).toEqual([["PAU-9", "second"], ["PAU-8", "first"], ["PAU-7", "y"]])
  })
})

describe("sensitiveEntry", () => {
  const base = { at: "2026-10-30T09:00:00", actor: "Aoife", staffRole: "owner" as const, action: "tenant.suspended", target: "A", detail: "d", before: { status: "active" }, after: { status: "suspended" } }
  it("records the role, change and trimmed reason", () => {
    expect(sensitiveEntry([], { ...base, reason: "  Unpaid for 60 days " })).toMatchObject({ id: "PAU-1", staffRole: "owner", before: { status: "active" }, after: { status: "suspended" }, reason: "Unpaid for 60 days" })
  })
  it("refuses a reason under 10 characters (D7)", () => {
    expect(() => sensitiveEntry([], { ...base, reason: " short " })).toThrow(/at least 10/)
  })
})

describe("liveRows seat use", () => {
  it("is 0 when the plan has no user limit", () => {
    const derived = { a: { planName: "P", planRank: 0, userLimit: 0, currency: "", reactivatesAs: "active" as const, byStatus: { active: { mrr: null, health: health(90) } } } }
    expect(liveRows([{ id: "a", name: "A", slug: "a", subdomain: "a", plan: "p", status: "active", users: 5, storageGb: 1, createdAt: "2026-01-01" }], derived)[0].seatPct).toBe(0)
  })
})
