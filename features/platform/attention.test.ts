import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { ATTENTION_DAYS, attentionItems, dueLabel } from "./attention"
import type { DataRequest, Invoice, Plan, PlatformSeed, PlatformTenant, SupportRequest } from "./types"

const plan: Plan = { id: "b", name: "Business", priceMonthly: 149, currency: "EUR", trialDays: 14, limits: { activeUsers: 40, storageGb: 50, messages: 5000, transcriptionMinutes: 600 } }
const tenant = (over: Partial<PlatformTenant>): PlatformTenant => ({
  id: "t", name: "T", slug: "t", subdomain: "t.x", plan: "b", status: "active", users: 10, storageGb: 5, messages: 100, transcriptionMinutes: 10,
  createdAt: "2026-01-01T10:00:00", contacts: [], billing: { paymentMethod: "Card" }, ...over,
})
const inv = (over: Partial<Invoice>): Invoice => ({
  id: "i", tenantId: "t", number: "n", issuedAt: "2026-10-02T08:00:00", dueAt: "2026-10-16T08:00:00", amount: 149, currency: "EUR", status: "failed", attempts: 2, nextRetryAt: null, lines: [], ...over,
})
const req = (over: Partial<SupportRequest>): SupportRequest =>
  ({ id: "SUP-1", tenantId: "t", requester: "R", reason: "x", status: "requested", requestedAt: "2026-10-19T08:00:00", expiresAt: null, grantedBy: null, ...over })
const dsr = (over: Partial<DataRequest>): DataRequest =>
  ({ id: "DSR-1", tenantId: "t", kind: "export", subject: "tenant", requestedBy: "X", requestedAt: "2026-10-10T09:00:00", dueAt: "2026-10-25T09:00:00", status: "received", note: "", ...over })

const today = "2026-10-20T09:00:00"
type Input = Pick<PlatformSeed, "tenants" | "plans" | "invoices" | "requests" | "dataRequests">
const seed = (over: Partial<Input>): Input => ({ tenants: [], plans: [plan], invoices: [], requests: [], dataRequests: [], ...over })

describe("attentionItems", () => {
  it("lists past-due tenants with the amount owed, linking to the billing tab", () => {
    const items = attentionItems(seed({
      tenants: [tenant({ id: "a", name: "A", status: "past_due", billing: { paymentMethod: "Card", graceEndsOn: "2026-10-27" } })],
      invoices: [inv({ id: "1", tenantId: "a" }), inv({ id: "2", tenantId: "a", amount: 100 }), inv({ id: "3", tenantId: "a", status: "paid" })],
    }), today)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: "past_due", tenant: "A", href: "/platform/tenants/a/billing", due: "2026-10-27" })
    expect(items[0].detail).toBe("€249 overdue · 2 failed payments")
    expect(items[0].when).toBe("Grace ends in 7 days")
  })

  it("lists trials ending within 7 days, not later ones or paying tenants", () => {
    const items = attentionItems(seed({
      tenants: [
        tenant({ id: "a", status: "trial", billing: { paymentMethod: "", trialEndsOn: "2026-10-27" } }),
        tenant({ id: "b", status: "trial", billing: { paymentMethod: "", trialEndsOn: "2026-10-28" } }),
        tenant({ id: "c", status: "active", billing: { paymentMethod: "", trialEndsOn: "2026-10-21" } }),
      ],
    }), today)
    expect(ATTENTION_DAYS).toBe(7)
    expect(items.map((i) => [i.kind, i.href])).toEqual([["trial_ending", "/platform/tenants/a"]])
  })

  it("flags tenants at 90% or more of any plan limit, naming the fullest one; suspended tenants are skipped", () => {
    const items = attentionItems(seed({
      tenants: [
        tenant({ id: "a", users: 36 }), // 90% users
        tenant({ id: "b", users: 10, storageGb: 49, messages: 4900 }), // 98% storage + 98% messages
        tenant({ id: "c", users: 35 }), // 87.5%: fine
        tenant({ id: "d", status: "suspended", users: 40 }),
      ],
    }), today)
    expect(items.map((i) => i.tenantId)).toEqual(["b", "a"])
    expect(items[0]).toMatchObject({ kind: "limit", href: "/platform/tenants/b/usage", detail: "Storage at 98% of the plan limit · 1 more limit" })
    expect(items[1].detail).toBe("Active users at 90% of the plan limit")
  })

  it("lists pending support requests and open data requests due within 7 days (overdue too)", () => {
    const items = attentionItems(seed({
      tenants: [tenant({ id: "t", name: "T" })],
      requests: [req({}), req({ id: "SUP-2", status: "granted" })],
      dataRequests: [
        dsr({}),
        dsr({ id: "DSR-2", dueAt: "2026-10-18T09:00:00", status: "in_progress", kind: "deletion" }),
        dsr({ id: "DSR-3", dueAt: "2026-10-28T09:00:00" }), // 8 days out
        dsr({ id: "DSR-4", status: "completed" }),
      ],
    }), today)
    expect(items.map((i) => i.id)).toEqual(["dsr-DSR-2", "sup-SUP-1", "dsr-DSR-1"])
    expect(items.find((i) => i.kind === "support")?.href).toBe("/platform/support")
    expect(items.find((i) => i.id === "dsr-DSR-1")).toMatchObject({ href: "/platform/data-requests", detail: "Export request due" })
  })

  it("orders overdue money first, then the soonest deadlines, then limits", () => {
    const items = attentionItems(seed({
      tenants: [
        tenant({ id: "lim", users: 40 }),
        tenant({ id: "tr", status: "trial", billing: { paymentMethod: "", trialEndsOn: "2026-10-22" } }),
        tenant({ id: "pd1", status: "past_due" }),
        tenant({ id: "pd2", status: "past_due" }),
      ],
      invoices: [inv({ tenantId: "pd1", amount: 49 }), inv({ id: "2", tenantId: "pd2", amount: 399 })],
      dataRequests: [dsr({ tenantId: "lim", dueAt: "2026-10-21T09:00:00" })],
    }), today)
    expect(items.map((i) => i.id)).toEqual(["pay-pd2", "pay-pd1", "dsr-DSR-1", "trial-tr", "limit-lim"])
  })

  it("counts each kind in the seed", () => {
    const read = <T,>(f: string): T => JSON.parse(readFileSync(`public/data/${f}`, "utf8"))
    const items = attentionItems({
      tenants: read<{ tenants: PlatformTenant[] }>("platform/tenants.json").tenants,
      plans: read<Plan[]>("billing/plans.json"),
      invoices: read<{ invoices: Invoice[] }>("platform/invoices.json").invoices,
      requests: read<{ requests: SupportRequest[] }>("support/requests.json").requests,
      dataRequests: read<{ requests: DataRequest[] }>("platform/data-requests.json").requests,
    }, read<{ today: string }>("shell/org.json").today)
    const count = (k: string) => items.filter((i) => i.kind === k).length
    expect(count("past_due")).toBe(2) // t3, t10
    expect(count("trial_ending")).toBe(1) // t6, ends 26 Oct
    expect(count("limit")).toBe(3) // t3 users, t9 users+storage, t11 users+storage
    expect(count("support")).toBe(3) // SUP-102, SUP-106, SUP-109
    expect(count("data_request")).toBe(1) // DSR-7, due 25 Oct
    expect(items.slice(0, 2).map((i) => i.tenantId)).toEqual(["t10", "t3"])
  })
})

describe("attentionItems past-due text", () => {
  const pd = tenant({ id: "a", status: "past_due" })
  it("leaves amounts out when asked (no billing.read)", () => {
    const items = attentionItems(seed({ tenants: [pd], invoices: [inv({ tenantId: "a" })] }), today, { amounts: false })
    expect(items[0].detail).toBe("1 failed payment")
  })
  it("says only 'Payment past due' when no failed invoice is on record", () => {
    expect(attentionItems(seed({ tenants: [pd] }), today)[0].detail).toBe("Payment past due")
    expect(attentionItems(seed({ tenants: [pd] }), today, { amounts: false })[0].detail).toBe("Payment past due")
  })
  it("orders a bare-date deadline and a date-time on the same day by time", () => {
    const items = attentionItems(seed({
      tenants: [tenant({ id: "tr", status: "trial", billing: { paymentMethod: "", trialEndsOn: "2026-10-22" } })],
      dataRequests: [dsr({ dueAt: "2026-10-22T09:00:00" })],
    }), today)
    expect(items.map((i) => i.id)).toEqual(["trial-tr", "dsr-DSR-1"])
  })
})

describe("dueLabel", () => {
  it("says today, in n days or n days overdue", () => {
    expect(dueLabel("2026-10-20T17:00:00", today)).toBe("Today")
    expect(dueLabel("2026-10-21", today)).toBe("Tomorrow")
    expect(dueLabel("2026-10-25", today)).toBe("In 5 days")
    expect(dueLabel("2026-10-19", today)).toBe("1 day overdue")
    expect(dueLabel("2026-10-15", today)).toBe("5 days overdue")
  })
})
