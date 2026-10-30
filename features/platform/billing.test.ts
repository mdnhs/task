import { describe, expect, it } from "vitest"

import {
  DUNNING_MAX, billingData, billingSummary, billingViewCounts, canRefund, canVoid, dunning, filterInvoices, invoiceHistory, markPaid, paidAt,
  refund, retryPayment, sortInvoices, voidInvoice,
} from "./billing"
import type { Invoice, PlatformSeed, StaffMember } from "./types"

const inv = (over: Partial<Invoice> = {}): Invoice => ({
  id: "INV-1", tenantId: "t1", number: "OD-1", issuedAt: "2026-10-02T08:00:00", dueAt: "2026-10-16T08:00:00", amount: 149, currency: "EUR",
  status: "failed", attempts: 1, nextRetryAt: "2026-10-19T08:00:00", lines: [{ label: "Business plan, October 2026", amount: 149 }], ...over,
})
const AT = "2026-10-20T09:00:00"
const by = { actor: "Aoife Brennan", reason: "Customer paid by bank transfer" }

describe("retryPayment", () => {
  it("increments attempts and marks the invoice paid when the tenant has a payment method", () => {
    const out = retryPayment(inv(), { at: AT, hasPaymentMethod: true, actor: by.actor })
    expect(out.attempts).toBe(2)
    expect(out.status).toBe("paid")
    expect(out.nextRetryAt).toBeNull()
    expect(out.events?.at(-1)).toMatchObject({ kind: "charged", at: AT, attempt: 2 })
  })

  it("increments attempts and schedules the next retry 3 days out when the charge fails", () => {
    const out = retryPayment(inv(), { at: AT, hasPaymentMethod: false, actor: by.actor })
    expect(out.attempts).toBe(2)
    expect(out.status).toBe("failed")
    expect(out.nextRetryAt).toBe("2026-10-23T09:00:00")
    expect(out.events?.at(-1)).toMatchObject({ kind: "charge_failed", attempt: 2 })
  })

  it("stops scheduling after the last dunning attempt", () => {
    const out = retryPayment(inv({ attempts: DUNNING_MAX - 1 }), { at: AT, hasPaymentMethod: false, actor: by.actor })
    expect(out.attempts).toBe(DUNNING_MAX)
    expect(out.nextRetryAt).toBeNull()
  })

  it("crosses a month end on the wall clock", () => {
    expect(retryPayment(inv(), { at: "2026-10-30T23:30:00", hasPaymentMethod: false, actor: by.actor }).nextRetryAt).toBe("2026-11-02T23:30:00")
  })

  it("is refused for paid, refunded and void invoices and leaves the input unchanged", () => {
    for (const status of ["paid", "refunded", "void"] as const) {
      expect(() => retryPayment(inv({ status }), { at: AT, hasPaymentMethod: true, actor: by.actor })).toThrow()
    }
    const i = inv()
    retryPayment(i, { at: AT, hasPaymentMethod: true, actor: by.actor })
    expect(i.attempts).toBe(1)
    expect(i.events).toBeUndefined()
  })
})

describe("refund / void / markPaid", () => {
  it("refunds only a paid invoice", () => {
    expect(canRefund(inv({ status: "paid" }))).toBe(true)
    const out = refund(inv({ status: "paid", nextRetryAt: null }), { at: AT, ...by })
    expect(out.status).toBe("refunded")
    expect(out.events?.at(-1)).toMatchObject({ kind: "refunded", by: by.actor, reason: by.reason })
    for (const status of ["open", "failed", "refunded", "void"] as const) {
      expect(canRefund(inv({ status }))).toBe(false)
      expect(() => refund(inv({ status }), { at: AT, ...by })).toThrow()
    }
  })

  it("voids only an open or failed invoice and clears its retry", () => {
    for (const status of ["open", "failed"] as const) {
      expect(canVoid(inv({ status }))).toBe(true)
      const out = voidInvoice(inv({ status }), { at: AT, ...by })
      expect(out.status).toBe("void")
      expect(out.nextRetryAt).toBeNull()
    }
    for (const status of ["paid", "refunded", "void"] as const) {
      expect(canVoid(inv({ status }))).toBe(false)
      expect(() => voidInvoice(inv({ status }), { at: AT, ...by })).toThrow()
    }
  })

  it("marks an open or failed invoice paid (no attempt is added) and refuses the rest", () => {
    const out = markPaid(inv(), { at: AT, ...by })
    expect(out).toMatchObject({ status: "paid", attempts: 1, nextRetryAt: null })
    expect(paidAt(out)).toBe(AT)
    expect(() => markPaid(inv({ status: "void" }), { at: AT, ...by })).toThrow()
  })

  it("needs a reason of at least 10 characters (D7)", () => {
    expect(() => refund(inv({ status: "paid" }), { at: AT, actor: by.actor, reason: "  too short " })).toThrow()
    expect(() => voidInvoice(inv(), { at: AT, actor: by.actor, reason: "" })).toThrow()
    expect(() => markPaid(inv(), { at: AT, actor: by.actor, reason: "short" })).toThrow()
  })
})

describe("dunning", () => {
  it("lists past attempts as failed, then the next retry and the planned ones", () => {
    const d = dunning(inv({ attempts: 2, nextRetryAt: "2026-10-23T08:00:00" }))
    expect(d?.steps.map((s) => s.state)).toEqual(["failed", "failed", "next"])
    expect(d?.steps[2].at).toBe("2026-10-23T08:00:00")
    expect(d?.suggestSuspend).toBe(false)
  })

  it("suggests suspension after the 3rd failure, never earlier", () => {
    expect(dunning(inv({ attempts: 3, nextRetryAt: null }))?.suggestSuspend).toBe(true)
    expect(dunning(inv({ attempts: 1 }))?.steps.map((s) => s.state)).toEqual(["failed", "next", "planned"])
    expect(dunning(inv({ status: "paid" }))).toBeNull()
  })
})

describe("history", () => {
  it("derives issue and charge lines from the seed, then appends recorded events, oldest first", () => {
    const h = invoiceHistory(refund(inv({ status: "paid", nextRetryAt: null }), { at: AT, ...by }))
    expect(h[0]).toMatchObject({ kind: "issued", at: "2026-10-02T08:00:00" })
    expect(h.map((e) => e.kind)).toEqual(["issued", "charged", "refunded"])
    expect(h.at(-1)?.reason).toBe(by.reason)
  })
  // seedState: the seed status is read back from the recorded events, so the derived lines never repeat them.
  it("marks a failed seed invoice paid: one failed attempt, then the manual payment", () => {
    const h = invoiceHistory(markPaid(inv(), { at: AT, ...by }))
    expect(h.map((e) => e.kind)).toEqual(["issued", "charge_failed", "marked_paid"])
  })
  it("retries an open invoice: no derived attempt, then the recorded charge", () => {
    const h = invoiceHistory(retryPayment(inv({ status: "open", attempts: 0, nextRetryAt: null }), { at: AT, hasPaymentMethod: true, actor: by.actor }))
    expect(h.map((e) => [e.kind, e.attempt])).toEqual([["issued", undefined], ["charged", 1]])
  })
  it("records a failed retry after the seed's failed attempt", () => {
    const h = invoiceHistory(retryPayment(inv(), { at: AT, hasPaymentMethod: false, actor: by.actor }))
    expect(h.map((e) => [e.kind, e.attempt])).toEqual([["issued", undefined], ["charge_failed", 1], ["charge_failed", 2]])
  })
  it("voids an open invoice without inventing a charge", () => {
    const h = invoiceHistory(voidInvoice(inv({ status: "open", attempts: 0, nextRetryAt: null }), { at: AT, ...by }))
    expect(h.map((e) => e.kind)).toEqual(["issued", "voided"])
  })
})

describe("ledger", () => {
  const rows = [
    inv({ id: "A", number: "OD-3", status: "paid", amount: 49, dueAt: "2026-10-31T23:30:00", nextRetryAt: null }),
    inv({ id: "B", number: "OD-1", status: "open", amount: 120, attempts: 0, nextRetryAt: null }),
    inv({ id: "C", number: "OD-2", status: "failed", amount: 399 }),
    inv({ id: "D", number: "OD-4", status: "refunded", amount: 149, nextRetryAt: null }),
    inv({ id: "E", number: "OD-5", status: "paid", amount: 149, dueAt: "2026-09-30T23:30:00", nextRetryAt: null }),
  ]

  it("totals collected this month (by payment date, platform clock), open, failed and refunded", () => {
    const s = billingSummary(rows, "2026-10")
    expect(s.collected).toEqual({ amount: 49, count: 1 })
    expect(s.open).toEqual({ amount: 120, count: 1 })
    expect(s.failed).toEqual({ amount: 399, count: 1 })
    expect(s.refunded).toEqual({ amount: 149, count: 1 })
  })

  it("filters by saved view and counts each view", () => {
    expect(filterInvoices(rows, { view: "failed", q: "" }).map((r) => r.id)).toEqual(["C"])
    expect(billingViewCounts(rows)).toEqual({ all: 5, open: 1, failed: 1, refunded: 1 })
  })

  it("sorts by amount and number without mutating the input", () => {
    const r = rows.map((x) => ({ ...x, tenantName: "T" }))
    expect(sortInvoices(r, { key: "amount", dir: "desc" }).map((x) => x.id)).toEqual(["C", "D", "E", "B", "A"])
    expect(sortInvoices(r, { key: "number", dir: "asc" }).map((x) => x.id)).toEqual(["B", "C", "A", "D", "E"])
    expect(r[0].id).toBe("A")
  })
})

describe("billingData", () => {
  const seed = {
    tenants: [
      { id: "t1", name: "Northgate", slug: "northgate", billing: { paymentMethod: "Card ending 4000" } },
      { id: "t2", name: "Harbourline", slug: "harbourline", billing: { paymentMethod: "None on file" } },
    ],
    invoices: [inv({ tenantId: "t1" }), inv({ id: "INV-2", tenantId: "t2", status: "open", attempts: 0, nextRetryAt: null })],
  } as unknown as PlatformSeed
  const op = (role: StaffMember["role"]) => ({ id: "s", name: "Aoife", email: "", role, mfa: true, lastSignInAt: null, status: "active" }) as StaffMember

  it("joins tenant names and payment state, and gates the write actions on billing.write", () => {
    const d = billingData(seed, op("billing"), { provider: "Stripe", mode: "test" })
    expect(d.invoices[0]).toMatchObject({ tenantName: "Northgate", tenantSlug: "northgate", hasPaymentMethod: true })
    expect(d.invoices[1].hasPaymentMethod).toBe(false)
    expect(d.can.write).toBe(true)
    expect(billingData(seed, op("viewer"), { provider: "Stripe", mode: "test" }).can.write).toBe(false)
  })
  it("ships only invoice fields plus the tenant's name, slug, status and payment state (no other tenant data)", () => {
    const row = billingData(seed, op("billing"), { provider: "Stripe", mode: "test" }).invoices[0]
    const invoiceKeys = Object.keys(inv({ tenantId: "t1" }))
    const extra = Object.keys(row).filter((k) => !invoiceKeys.includes(k)).sort()
    expect(extra).toEqual(["hasPaymentMethod", "paymentMethod", "tenantName", "tenantSlug", "tenantStatus"])
  })
})
