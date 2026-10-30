import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { kpis, monthKey, mrrSeries, type Kpis } from "./metrics"
import { tenantMrr } from "./logic"
import type { Plan, PlatformTenant, SubEvent } from "./types"

const ev = (over: Partial<SubEvent>): SubEvent => ({ id: "e", tenantId: "t", at: "2026-01-10T09:00:00", kind: "start", plan: "business", mrrDelta: 149, ...over })
const tenant = (over: Partial<PlatformTenant> = {}): PlatformTenant => ({
  id: "t", name: "A", slug: "a", subdomain: "a.x", plan: "business", status: "active", users: 1, storageGb: 1, messages: 1, transcriptionMinutes: 1,
  createdAt: "2026-01-01T10:00:00", contacts: [], billing: { paymentMethod: "Card" }, ...over,
})

describe("monthKey", () => {
  it("uses the wall clock, no UTC shift", () => {
    expect(monthKey("2026-09-30T23:30:00")).toBe("2026-09")
    expect(monthKey("2026-10-01T00:10:00")).toBe("2026-10")
  })
})

describe("mrrSeries", () => {
  const events = [ev({}), ev({ id: "u", kind: "upgrade", at: "2026-03-05T10:00:00", mrrDelta: 250 })]
  it("accumulates and classifies", () => {
    const s = mrrSeries(events, "2026-04", 4)
    expect(s.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"])
    expect(s.map((m) => m.mrr)).toEqual([149, 149, 399, 399])
    expect(s[0].new).toBe(149)
    expect(s[2].expansion).toBe(250)
  })
  it("counts a month-end 23:30 event in that month", () => {
    const s = mrrSeries([ev({ at: "2026-01-31T23:30:00" })], "2026-02", 2)
    expect(s[0].new).toBe(149)
    expect(s[1].new).toBe(0)
  })
  it("keeps MRR from events before the window", () => {
    expect(mrrSeries(events, "2026-04", 1)[0].mrr).toBe(399)
  })
  it("books a cancel as negative churn", () => {
    const s = mrrSeries([...events, ev({ id: "c", kind: "cancel", at: "2026-04-02T10:00:00", mrrDelta: -399 })], "2026-04", 2)
    expect(s[1].churn).toBe(-399)
    expect(s[1].mrr).toBe(0)
  })
})

describe("kpis", () => {
  const events = [ev({}), ev({ id: "u", kind: "upgrade", at: "2026-03-05T10:00:00", mrrDelta: 250 })]
  it("arr is mrr x 12", () => {
    const k = kpis(mrrSeries(events, "2026-04", 4), [tenant()], events)
    expect(k.mrr).toBe(399)
    expect(k.arr).toBe(399 * 12)
    expect(k.arpa).toBe(399)
  })
  it("nrr and logo churn are null without a prior base", () => {
    const k = kpis(mrrSeries(events, "2026-01", 1), [tenant()], events)
    expect(k.nrrPct).toBeNull()
    expect(k.logoChurnPct).toBeNull()
    expect(k.mrrDeltaPct).toBeNull()
  })
  it("arpa is 0 with no paying tenants", () => {
    const k = kpis(mrrSeries([], "2026-04", 4), [tenant({ status: "trial" })], [])
    expect(k.arpa).toBe(0)
    expect(k.mrr).toBe(0)
    expect(k.trials).toBe(1)
  })
  it("computes churn rates and trial conversion", () => {
    const e = [ev({}), ev({ id: "s", tenantId: "u", mrrDelta: 49, plan: "starter", at: "2026-01-12T09:00:00" }), ev({ id: "c", tenantId: "u", kind: "cancel", at: "2026-03-03T09:00:00", mrrDelta: -49 })]
    const ts = [tenant(), tenant({ id: "u", status: "suspended" }), tenant({ id: "v", status: "trial", createdAt: "2026-03-20T10:00:00" })]
    const k = kpis(mrrSeries(e, "2026-03", 3), ts, e)
    expect(k.logoChurnPct).toBe(50)
    expect(k.nrrPct).toBeCloseTo((198 - 49) / 198 * 100)
    expect(k.trialConversionPct).toBe(100)
  })
  it("nrr only counts movements of tenants already paying last month", () => {
    // t pays 149 since Jan and upgrades +50 in March; w starts in March at 99 and upgrades +50 the same month.
    const e = [
      ev({}),
      ev({ id: "u", kind: "upgrade", at: "2026-03-05T10:00:00", mrrDelta: 50 }),
      ev({ id: "s", tenantId: "w", at: "2026-03-02T10:00:00", mrrDelta: 99 }),
      ev({ id: "x", tenantId: "w", kind: "upgrade", at: "2026-03-20T10:00:00", mrrDelta: 50 }),
    ]
    const k: Kpis = kpis(mrrSeries(e, "2026-03", 3), [tenant(), tenant({ id: "w" })], e)
    expect(k.nrrPct).toBeCloseTo(((149 + 50) / 149) * 100)
  })
  it("nrr ignores a tenant that cancels in the month it started", () => {
    const e = [ev({}), ev({ id: "s", tenantId: "w", at: "2026-02-02T10:00:00", mrrDelta: 49 }), ev({ id: "c", tenantId: "w", kind: "cancel", at: "2026-02-20T10:00:00", mrrDelta: -49 })]
    expect(kpis(mrrSeries(e, "2026-02", 2), [tenant()], e).nrrPct).toBe(100)
  })
})

describe("seed consistency", () => {
  const read = <T>(f: string): T => JSON.parse(readFileSync(`public/data/${f}`, "utf8"))
  it("current-month MRR equals the sum of tenantMrr", () => {
    const { events } = read<{ events: SubEvent[] }>("platform/subscriptions.json")
    const { tenants } = read<{ tenants: PlatformTenant[] }>("platform/tenants.json")
    const plans = read<Plan[]>("billing/plans.json")
    const { today } = read<{ today: string }>("shell/org.json")
    const series = mrrSeries(events, monthKey(today), 12)
    expect(series).toHaveLength(12)
    expect(series[11].mrr).toBe(tenants.reduce((s, t) => s + tenantMrr(t, plans), 0))
  })
  it("has movement in the current month, so overview deltas are meaningful", () => {
    const { events } = read<{ events: SubEvent[] }>("platform/subscriptions.json")
    const { today } = read<{ today: string }>("shell/org.json")
    expect(events.some((e) => monthKey(e.at) === monthKey(today))).toBe(true)
  })
  it("every tenant's plan matches its latest subscription event", () => {
    const { events } = read<{ events: SubEvent[] }>("platform/subscriptions.json")
    const { tenants } = read<{ tenants: PlatformTenant[] }>("platform/tenants.json")
    for (const t of tenants) {
      const last = events.filter((e) => e.tenantId === t.id).sort((a, b) => a.at.localeCompare(b.at)).at(-1)
      if (last) expect([t.id, last.plan]).toEqual([t.id, t.plan])
    }
  })
  it("past-due tenants have failed invoices and trials have no paid ones", () => {
    const { invoices } = read<{ invoices: { tenantId: string; status: string }[] }>("platform/invoices.json")
    const { tenants } = read<{ tenants: PlatformTenant[] }>("platform/tenants.json")
    for (const t of tenants.filter((x) => x.status === "past_due")) expect(invoices.some((i) => i.tenantId === t.id && i.status === "failed")).toBe(true)
    for (const t of tenants.filter((x) => x.status === "trial")) expect(invoices.some((i) => i.tenantId === t.id && i.status === "paid")).toBe(false)
  })
})
