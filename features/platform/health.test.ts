import { describe, expect, it } from "vitest"

import { healthScore } from "./health"
import type { Invoice, Plan, PlatformTenant, UsagePoint } from "./types"

const plan: Plan = { id: "b", name: "B", priceMonthly: 149, currency: "EUR", trialDays: 14, limits: { activeUsers: 40, storageGb: 50, messages: 5000, transcriptionMinutes: 600 } }
const tenant = (over: Partial<PlatformTenant> = {}): PlatformTenant => ({
  id: "t", name: "A", slug: "a", subdomain: "a.x", plan: "b", status: "active", users: 20, storageGb: 5, messages: 100, transcriptionMinutes: 10,
  createdAt: "2025-01-01T10:00:00", contacts: [], billing: { paymentMethod: "Card" }, ...over,
})
const inv = (status: Invoice["status"], i = 1): Invoice => ({ id: `i${i}`, tenantId: "t", number: "n", issuedAt: "2026-10-02T08:00:00", dueAt: "2026-10-16T08:00:00", amount: 149, currency: "EUR", status, attempts: 1, nextRetryAt: null, lines: [] })
const steady = (n = 60, v = 20): UsagePoint[] => Array.from({ length: n }, (_, i) => ({ date: `d${i}`, activeUsers: v, storageGb: 5, messages: 100, transcriptionMinutes: 10 }))

describe("healthScore", () => {
  it("scores a steady paying tenant as healthy", () => {
    const h = healthScore(tenant(), plan, steady(), [inv("paid")], 0)
    expect(h.score).toBeGreaterThanOrEqual(70)
    expect(h.band).toBe("healthy")
  })
  it("flags a past-due tenant with failed payments as at risk", () => {
    const h = healthScore(tenant({ status: "past_due" }), plan, steady(), [inv("failed", 1), inv("failed", 2)], 0)
    expect(h.band).toBe("at_risk")
    expect(h.reasons).toContain("2 failed payments")
  })
  it("computes for a trial with no invoices or usage", () => {
    const h = healthScore(tenant({ status: "trial" }), plan, [], [], 0)
    expect(h.score).toBeGreaterThanOrEqual(0)
    expect(h.score).toBeLessThanOrEqual(100)
  })
  it("handles a missing plan", () => {
    expect(() => healthScore(tenant(), undefined, [], [], 0)).not.toThrow()
  })
  it("adds a reason near the user limit", () => {
    const h = healthScore(tenant({ users: 39 }), plan, steady(), [inv("paid")], 0)
    expect(h.reasons).toContain("Near user limit")
  })
  it("penalises falling usage and open support requests", () => {
    const usage = [...steady(30, 20), ...steady(30, 10)]
    const h = healthScore(tenant(), plan, usage, [], 2)
    expect(h.reasons.some((r) => r.startsWith("Usage down"))).toBe(true)
    expect(h.reasons).toContain("2 open support requests")
  })
  it("ignores failed invoices of other statuses", () => {
    expect(healthScore(tenant(), plan, steady(), [inv("refunded"), inv("void")], 0).reasons).not.toContain("1 failed payment")
  })
  it("gives a clean tenant 100 with no reasons", () => {
    expect(healthScore(tenant(), plan, steady(), [inv("paid")], 0)).toEqual({ score: 100, band: "healthy", reasons: [] })
  })
  it("flags the user limit only above 95%", () => {
    // 38 of 40 is exactly 95%: not flagged; 39 of 40 (97.5%) is.
    expect(healthScore(tenant({ users: 38 }), plan, steady(), [], 0).reasons).not.toContain("Near user limit")
    expect(healthScore(tenant({ users: 39 }), plan, steady(), [], 0).reasons).toContain("Near user limit")
  })
  it("clamps the score at 0 and bands it at risk", () => {
    const usage = [...steady(30, 20), ...steady(30, 1)]
    const h = healthScore(tenant({ status: "suspended", users: 40 }), plan, usage, [inv("failed", 1), inv("failed", 2), inv("failed", 3)], 5)
    expect(h.score).toBe(0)
    expect(h.band).toBe("at_risk")
  })
  it("puts the band edges at 70 and 40", () => {
    // 100 - 30 (two failed) = 70: healthy; - 15 more (usage down) = 55: watch; past due 40 + 2 failed 30 = 30: at risk.
    expect(healthScore(tenant(), plan, steady(), [inv("failed", 1), inv("failed", 2)], 0).band).toBe("healthy")
    expect(healthScore(tenant(), plan, [...steady(30, 20), ...steady(30, 10)], [inv("failed", 1), inv("failed", 2)], 0)).toMatchObject({ score: 55, band: "watch" })
    expect(healthScore(tenant({ status: "past_due" }), plan, steady(), [inv("failed", 1), inv("failed", 2)], 0)).toMatchObject({ score: 30, band: "at_risk" })
  })
})
