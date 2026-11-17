import { describe, expect, test, vi } from "vitest"
import { fakeApi, problem } from "@/test/support/fake-api"
import { ApiError, userMessage } from "@/lib/api/problem"
import { formatMinor, minorOf, planCards, toInvoice, toSubscription } from "./adapters"
import { makeBillingClient } from "./client"

const SUB = {
  planId: "business", planName: "Business", priceMonthlyMinor: 14900, currency: "EUR", status: "active", seats: 40, seatsUsed: 12, trialEndsAt: null,
  currentPeriodEnd: "2026-12-17T00:00:00.000Z", cancelAtPeriodEnd: false, billingState: "ok", graceEndsAt: null, hasProviderSubscription: true, hasCustomer: true,
}
const INV = { id: "0b6d1f3e-2a47-4a55-9c1e-7d6a9f0c5e11", providerInvoiceId: "in_1QxYz", amountMinor: 14900, currency: "EUR", status: "paid", hostedUrl: "https://invoice.stripe.com/i/1", periodStart: "2026-11-17T00:00:00.000Z", periodEnd: "2026-12-17T00:00:00.000Z", createdAt: "2026-11-17T00:00:05.000Z" }
const PLANS = [
  { id: "starter", name: "Starter", priceMonthly: 49, currency: "EUR", trialDays: 14, limits: { activeUsers: 10, storageGb: 10, messages: 1000, transcriptionMinutes: 120 } },
  { id: "business", name: "Business", priceMonthly: 149, currency: "EUR", trialDays: 14, limits: { activeUsers: 40, storageGb: 50, messages: 5000, transcriptionMinutes: 600 } },
]

describe("T6.4 billing adapters: flat monthly prices in minor units, integers only", () => {
  test("toSubscription keeps the DTO's integers and never invents a field", () => {
    expect(toSubscription(SUB)).toMatchObject({ planId: "business", planName: "Business", priceMinor: 14900, currency: "EUR", seats: 40, seatsUsed: 12, cancelAtPeriodEnd: false, billingState: "ok", hasCustomer: true })
  })

  test("a missing or mistyped required field throws (no silent default)", () => {
    const noSeats: Record<string, unknown> = { ...SUB }
    delete noSeats.seats
    expect(() => toSubscription(noSeats)).toThrow(/seats/)
    expect(() => toSubscription({ ...SUB, priceMonthlyMinor: 149.5 })).toThrow(/priceMonthlyMinor/)
    expect(() => toSubscription({ ...SUB, billingState: "weird" })).toThrow(/billingState/)
  })

  test("toInvoice maps the invoice DTO (number = provider id, amount in minor units, the hosted URL kept)", () => {
    expect(toInvoice(INV)).toEqual({ id: INV.id, number: "in_1QxYz", amountMinor: 14900, currency: "EUR", status: "paid", hostedUrl: "https://invoice.stripe.com/i/1", periodStart: INV.periodStart, periodEnd: INV.periodEnd, createdAt: INV.createdAt })
    expect(() => toInvoice({ ...INV, amountMinor: 14.9 })).toThrow(/amountMinor/)
  })

  test("a hosted invoice link that is not https is dropped", () => {
    expect(toInvoice({ ...INV, hostedUrl: "javascript:alert(1)" }).hostedUrl).toBeNull()
  })

  test("formatMinor formats integers by the currency's own digits (EUR 2, JPY 0) in the tenant's locale", () => {
    expect(formatMinor(14900, "EUR", "en-IE")).toBe("€149.00")
    expect(formatMinor(5, "EUR", "en-IE")).toBe("€0.05")
    expect(formatMinor(14900, "JPY", "en")).toBe("¥14,900")
    expect(formatMinor(-250, "EUR", "en-IE")).toBe("-€2.50")
    expect(formatMinor(900719925474099, "EUR", "en-IE")).toBe("€9,007,199,254,740.99") // no float rounding at the top of the safe range
  })

  test("minorOf converts the static plan table's whole amounts without floats", () => {
    expect(minorOf(149, "EUR")).toBe(14900)
    expect(minorOf(399, "JPY")).toBe(399)
  })

  test("planCards: static plans, current marked by id, price from the table, module count from the entitlements", () => {
    const ent = { productModules: [{ id: "M0", label: "Core", description: "" }, { id: "M1", label: "Tasks", description: "" }], modules: {}, assistant: "M2", defaultPlan: "starter", plans: { starter: ["M0"], business: ["M0", "M1"] } }
    const cards = planCards(PLANS, ent, "business")
    expect(cards.map((c) => [c.id, c.current, c.priceMinor, c.modules])).toEqual([["starter", false, 4900, 1], ["business", true, 14900, 2]])
  })
})

describe("T6.4 billing client: calls the API and follows the returned URL", () => {
  const nav = () => ({ go: vi.fn() })

  test("checkout posts the plan id and follows the hosted URL", async () => {
    const { client, calls } = fakeApi({ "POST /v1/billing/checkout": { url: "https://checkout.stripe.com/c/pay/cs_1" } })
    const n = nav()
    await makeBillingClient(client, n).checkout("business")
    expect(calls[0]).toMatchObject({ method: "post", path: "/v1/billing/checkout", body: { planId: "business" } })
    expect(n.go).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_1")
  })

  test("portal follows its URL; a URL that is not https is never followed", async () => {
    const good = fakeApi({ "POST /v1/billing/portal": { url: "https://billing.stripe.com/p/session_1" } })
    const n = nav()
    await makeBillingClient(good.client, n).portal()
    expect(n.go).toHaveBeenCalledWith("https://billing.stripe.com/p/session_1")
    const bad = fakeApi({ "POST /v1/billing/portal": { url: "javascript:alert(1)" } })
    const n2 = nav()
    await expect(makeBillingClient(bad.client, n2).portal()).rejects.toThrow()
    expect(n2.go).not.toHaveBeenCalled()
  })

  test("cancel and resume return the updated subscription", async () => {
    const { client, paths } = fakeApi({ "POST /v1/billing/cancel": { ...SUB, cancelAtPeriodEnd: true }, "POST /v1/billing/resume": SUB })
    const b = makeBillingClient(client, nav())
    expect((await b.cancel()).cancelAtPeriodEnd).toBe(true)
    expect((await b.resume()).cancelAtPeriodEnd).toBe(false)
    expect(paths()).toEqual(["POST /v1/billing/cancel", "POST /v1/billing/resume"])
  })

  test("seats is a PUT to the API only (a local cap: no provider call, no navigation)", async () => {
    const { client, calls } = fakeApi({ "PUT /v1/billing/seats": { ...SUB, seats: 25 } })
    const n = nav()
    const s = await makeBillingClient(client, n).setSeats(25)
    expect(calls[0]).toMatchObject({ method: "put", path: "/v1/billing/seats", body: { seats: 25 } })
    expect(s.seats).toBe(25)
    expect(n.go).not.toHaveBeenCalled()
  })

  test("422 seat_limit_exceeds_plan and seats_below_members show their own short message and a Ref", async () => {
    const over = fakeApi({ "PUT /v1/billing/seats": problem(422, "seat_limit_exceeds_plan") })
    const e1 = await makeBillingClient(over.client, nav()).setSeats(99).catch((e: unknown) => e)
    expect(e1).toBeInstanceOf(ApiError)
    expect(userMessage(e1)).toEqual({ text: "That is more seats than your plan allows.", ref: "req-1" })
    const below = fakeApi({ "PUT /v1/billing/seats": problem(422, "seats_below_members") })
    const e2 = await makeBillingClient(below.client, nav()).setSeats(1).catch((e: unknown) => e)
    expect(userMessage(e2).text).toBe("Seats can't be fewer than your active members.")
  })

  test("the other billing refusals have their own copy too (never the server's text)", () => {
    const msg = (code: string, status = 409) => userMessage(new ApiError(status, code, "")).text
    expect(msg("already_subscribed")).toBe("This company already has a subscription. Use Manage billing.")
    expect(msg("no_customer")).toBe("Start a plan first.")
    expect(msg("no_subscription")).toBe("There is no active subscription to change.")
    expect(msg("plan_not_purchasable", 422)).toBe("That plan can't be bought online yet.")
    expect(msg("billing_provider_error", 502)).toBe("The payment provider did not answer. Try again.")
  })
})
