import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { compact, isCompacted } from "./money"
import { delta, overviewData } from "./overview"
import type { AuditEntry, DataRequest, Invoice, Plan, PlatformSeed, PlatformTenant, StaffMember, SubEvent, SupportRequest } from "./types"

const read = <T,>(f: string): T => JSON.parse(readFileSync(`public/data/${f}`, "utf8"))
const seed = {
  tenants: read<{ tenants: PlatformTenant[] }>("platform/tenants.json").tenants,
  plans: read<Plan[]>("billing/plans.json"),
  invoices: read<{ invoices: Invoice[] }>("platform/invoices.json").invoices,
  requests: read<{ requests: SupportRequest[] }>("support/requests.json").requests,
  dataRequests: read<{ requests: DataRequest[] }>("platform/data-requests.json").requests,
  subscriptions: read<{ events: SubEvent[] }>("platform/subscriptions.json").events,
  audit: read<{ entries: AuditEntry[] }>("platform/audit.json").entries,
} as unknown as PlatformSeed
const today = read<{ today: string }>("shell/org.json").today
const op = (role: StaffMember["role"]): StaffMember => ({ id: "s", name: "S", email: "s@x", role, mfa: true, lastSignInAt: null, status: "active" })

describe("isCompacted", () => {
  it("is true only for k / m / bn suffixes", () => {
    expect(isCompacted(compact(12_400, "EUR").suffix)).toBe(true)
    expect(isCompacted(compact(1_234_567, "EUR").suffix)).toBe(true)
    expect(isCompacted(compact(640, "EUR").suffix)).toBe(false)
    expect(isCompacted("%")).toBe(false)
    expect(isCompacted(undefined)).toBe(false)
  })
})

describe("compact", () => {
  it("keeps small amounts whole and shortens large ones (D11)", () => {
    expect(compact(640, "EUR")).toEqual({ prefix: "€", value: "640", suffix: "" })
    expect(compact(1641, "EUR")).toEqual({ prefix: "€", value: "1.6", suffix: "k" })
    expect(compact(19692, "EUR")).toEqual({ prefix: "€", value: "19.7", suffix: "k" })
    expect(compact(1_234_567, "EUR")).toEqual({ prefix: "€", value: "1.2", suffix: "m" })
    expect(compact(12_000, "EUR")).toEqual({ prefix: "€", value: "12", suffix: "k" })
    expect(compact(14, "")).toEqual({ prefix: "", value: "14", suffix: "" })
  })
})

describe("delta", () => {
  it("shows the direction with an arrow and colours by meaning, not sign", () => {
    expect(delta(3.24, "pct", "up")).toEqual({ text: "▲ 3.2%", tone: "good" })
    expect(delta(2, "count", "down")).toEqual({ text: "▲ 2", tone: "bad" })
    expect(delta(-1, "count", "down")).toEqual({ text: "▼ 1", tone: "good" })
    expect(delta(-0.5, "pts", "up")).toEqual({ text: "▼ 0.5 pts", tone: "bad" })
    expect(delta(0, "pct", "up")).toEqual({ text: "No change", tone: "flat" })
    expect(delta(null, "pct", "up")).toEqual({ text: "No prior month", tone: "flat" })
  })
})

describe("overviewData", () => {
  const d = overviewData(seed, today, op("owner"))
  it("builds six KPI cards from the seed", () => {
    expect(d.kpis.map((k) => k.title)).toEqual(["MRR", "ARR", "Active tenants", "Trials", "Past due", "Net revenue retention"])
    const [mrr, arr, active, trials, pastDue, nrr] = d.kpis
    expect([mrr.prefix, mrr.value, mrr.suffix, mrr.exact]).toEqual(["€", "1.7", "k", "€1,741"])
    expect(mrr.delta).toEqual({ text: "▲ 6.1%", tone: "good" }) // t4's October upgrade: +100 on 1,641
    expect(arr.exact).toBe("€20,892")
    expect(active.value).toBe("9")
    expect(trials.value).toBe("3")
    expect(trials.delta).toEqual({ text: "▲ 3", tone: "good" })
    expect(trials.sub).toBe("100% converted")
    expect(pastDue.value).toBe("2")
    expect(pastDue.delta.tone).toBe("flat")
    expect([nrr.value, nrr.suffix]).toEqual(["106", "%"])
    expect(mrr.note).toBe("vs Sep")
  })
  it("sends 12 series rows, plan mix and the last 8 audit lines", () => {
    expect(d.revenue?.series).toHaveLength(12)
    expect(d.revenue?.series[11]).toMatchObject({ month: "2026-10", label: "Oct", mrr: 1741, expansion: 100 })
    expect(d.planMix.map((p) => [p.name, p.paying, p.trials, p.total])).toEqual([["Starter", 1, 2, "€49"], ["Business", 6, 1, "€894"], ["Enterprise", 2, 0, "€798"]])
    expect(d.planMix.reduce((s, p) => s + p.share, 0)).toBeCloseTo(100)
    expect(d.planMix[1].shareLabel).toBe("51% of MRR")
    expect(d.activity).toHaveLength(8)
    expect(d.activity?.map((a) => a.at)).toEqual([...(d.activity ?? [])].map((a) => a.at).sort().reverse())
  })
  it("sends only the audit fields the card shows", () => {
    for (const a of d.activity ?? []) expect(Object.keys(a).sort()).toEqual(["action", "actor", "at", "detail", "id", "target"])
  })
  it("leaves out what the staff role can't open", () => {
    const s = overviewData(seed, today, op("support"))
    expect(s.activity).toBeNull()
    expect(s.attention.some((i) => i.kind === "support")).toBe(true)
    expect(s.kpis.every((k) => !k.href?.startsWith("/platform/billing"))).toBe(true)
    const b = overviewData(seed, today, op("billing"))
    expect(b.attention.some((i) => i.kind === "support")).toBe(false)
  })
  it("computes no revenue for a role without billing.read", () => {
    const s = overviewData(seed, today, op("support"))
    expect(s.revenue).toBeNull()
    expect(s.kpis.map((k) => k.title)).toEqual(["Active tenants", "Trials", "Past due"])
    expect(s.planMix.map((p) => [p.name, p.total, p.shareLabel])).toEqual([["Starter", "3 tenants", "25% of tenants"], ["Business", "7 tenants", "58% of tenants"], ["Enterprise", "2 tenants", "17% of tenants"]])
    expect(s.attention.find((i) => i.kind === "past_due")?.detail).toBe("2 failed payments")
    const payload = JSON.stringify(s)
    expect(payload).not.toContain("€")
    expect(payload).not.toMatch(/mrr|overdue/i)
    // Viewer has billing.read (all .read actions), so it sees revenue.
    expect(overviewData(seed, today, op("viewer")).revenue).not.toBeNull()
  })
})
