import { beforeEach, expect, test, vi } from "vitest"

const m = vi.hoisted(() => ({
  customersCreate: vi.fn(), sessionsCreate: vi.fn(), sessionsExpire: vi.fn(), subList: vi.fn(), invRetrieve: vi.fn(), portalCreate: vi.fn(), subUpdate: vi.fn(), subRetrieve: vi.fn(), constructEvent: vi.fn(), ctor: vi.fn(),
}))
vi.mock("stripe", () => ({
  default: class {
    customers = { create: m.customersCreate }
    checkout = { sessions: { create: m.sessionsCreate, expire: m.sessionsExpire } }
    invoices = { retrieve: m.invRetrieve }
    billingPortal = { sessions: { create: m.portalCreate } }
    subscriptions = { update: m.subUpdate, retrieve: m.subRetrieve, list: m.subList }
    webhooks = { constructEvent: m.constructEvent }
    constructor(key: string, opts: unknown) {
      m.ctor(key, opts)
    }
  },
}))

import { AppError } from "../../core/errors"
import { InvalidSignatureError, mapStripeEvent, mapStripeStatus, StripeBillingProvider } from "."

const cfg = { secretKey: "sk_test_abc123abc123", webhookSecret: "whsec_abc123abc123" }
const mk = () => new StripeBillingProvider({ get: async () => cfg })
beforeEach(() => Object.values(m).forEach((f) => f.mockReset()))

test("ensureCustomer: idempotent per tenant, tenant id in metadata", async () => {
  m.customersCreate.mockResolvedValue({ id: "cus_1" })
  expect(await mk().ensureCustomer({ tenantId: "t1", email: "a@b.ie", name: "Acme" })).toEqual({ customerId: "cus_1" })
  expect(m.customersCreate).toHaveBeenCalledWith({ email: "a@b.ie", name: "Acme", metadata: { tenantId: "t1" } }, { idempotencyKey: "opsdesk-customer-t1" })
  expect(m.ctor).toHaveBeenCalledWith(cfg.secretKey, expect.anything())
})

test("createCheckout: subscription mode, seats as quantity, trial days only when positive", async () => {
  m.sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/x" })
  const p = mk()
  const base = { customerId: "cus_1", priceId: "price_1", seats: 7, successUrl: "https://app/s", cancelUrl: "https://app/c" }
  expect(await p.createCheckout({ ...base, trialDays: 5 })).toEqual({ url: "https://checkout.stripe.com/x", sessionId: "cs_1" })
  expect(m.sessionsCreate).toHaveBeenLastCalledWith({
    mode: "subscription", customer: "cus_1", line_items: [{ price: "price_1", quantity: 7 }], success_url: "https://app/s", cancel_url: "https://app/c", subscription_data: { trial_period_days: 5 },
  })
  await p.createCheckout(base)
  expect(m.sessionsCreate.mock.lastCall![0]).not.toHaveProperty("subscription_data")
  m.sessionsCreate.mockResolvedValue({ id: "cs_2", url: null })
  await expect(p.createCheckout(base)).rejects.toThrow()
})

test("portal, cancel, resume, seats call Stripe with the right params", async () => {
  const p = mk()
  m.portalCreate.mockResolvedValue({ url: "https://billing.stripe.com/p" })
  expect(await p.createPortal({ customerId: "cus_1", returnUrl: "https://app/r" })).toEqual({ url: "https://billing.stripe.com/p" })
  expect(m.portalCreate).toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://app/r" })
  await p.cancelAtPeriodEnd({ subscriptionId: "sub_1" })
  expect(m.subUpdate).toHaveBeenLastCalledWith("sub_1", { cancel_at_period_end: true })
  await p.resume({ subscriptionId: "sub_1" })
  expect(m.subUpdate).toHaveBeenLastCalledWith("sub_1", { cancel_at_period_end: false })
  m.subRetrieve.mockResolvedValue({ items: { data: [{ id: "si_1" }] } })
  await p.updateSeats({ subscriptionId: "sub_1", seats: 12 })
  expect(m.subUpdate).toHaveBeenLastCalledWith("sub_1", { items: [{ id: "si_1", quantity: 12 }], proration_behavior: "create_prorations" })
})

test("unconfigured -> 503 billing_not_configured before any Stripe call", async () => {
  const p = new StripeBillingProvider({ get: async () => null })
  await expect(p.createPortal({ customerId: "c", returnUrl: "u" })).rejects.toMatchObject({ status: 503, code: "billing_not_configured" })
  await expect(p.parseWebhook("{}", "sig")).rejects.toBeInstanceOf(AppError)
  expect(m.ctor).not.toHaveBeenCalled()
})

test("parseWebhook: any verification failure becomes InvalidSignatureError (SDK message never surfaces)", async () => {
  m.constructEvent.mockImplementation(() => { throw new Error("secret detail whsec_abc123abc123") })
  const e = await mk().parseWebhook("{}", "sig").catch((x) => x)
  expect(e).toBeInstanceOf(InvalidSignatureError)
  expect(String(e.message)).not.toContain("whsec")
  expect(m.constructEvent).toHaveBeenCalledWith("{}", "sig", cfg.webhookSecret)
})

test("status mapping table", () => {
  expect(Object.fromEntries(["active", "trialing", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused", "weird"].map((s) => [s, mapStripeStatus(s)]))).toEqual({
    active: "active", trialing: "trialing", past_due: "past_due", unpaid: "unpaid", canceled: "canceled", incomplete: "incomplete", incomplete_expired: "canceled", paused: "paused", weird: null,
  })
})

const sub = (o: Record<string, unknown> = {}) => ({
  id: "evt_1", type: "customer.subscription.updated", created: 1_800_000_000,
  data: { object: { id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: true, trial_end: null, items: { data: [{ quantity: 4, price: { id: "price_1" }, current_period_end: 1_802_000_000 }] }, ...o } },
})

test("mapStripeEvent: subscription (item-level and legacy period end), seats, trial, cancel flag", () => {
  expect(mapStripeEvent(sub())).toEqual({
    kind: "subscription.updated", providerEventId: "evt_1", createdAt: new Date(1_800_000_000_000), subscriptionId: "sub_1", customerId: "cus_1", status: "active", priceId: "price_1", seats: 4,
    currentPeriodEnd: new Date(1_802_000_000_000), cancelAtPeriodEnd: true, trialEnd: null,
  })
  const legacy = mapStripeEvent(sub({ customer: { id: "cus_9" }, trial_end: 1_801_000_000, current_period_end: 1_803_000_000, items: { data: [{ price: { id: "price_1" } }] } }))
  expect(legacy).toMatchObject({ customerId: "cus_9", seats: 1, currentPeriodEnd: new Date(1_803_000_000_000), trialEnd: new Date(1_801_000_000_000) })
  expect(mapStripeEvent({ ...sub(), type: "customer.subscription.deleted" })).toMatchObject({ kind: "subscription.updated" })
  expect(mapStripeEvent(sub({ status: "mystery" }))).toMatchObject({ kind: "ignored" })
  expect(mapStripeEvent(sub({ items: { data: [] } }))).toMatchObject({ kind: "ignored" })
})

const inv = (type: string, o: Record<string, unknown> = {}) => ({
  id: "evt_2", type, created: 1_800_000_000,
  data: { object: { id: "in_1", customer: "cus_1", amount_paid: 14900, amount_due: 14900, currency: "eur", hosted_invoice_url: "https://invoice.stripe.com/i/1", period_start: 1_800_000_000, period_end: 1_802_000_000, ...o } },
})

test("mapStripeEvent: invoices keep integer minor units, uppercase the provider currency, drop non-https URLs", () => {
  expect(mapStripeEvent(inv("invoice.paid"))).toMatchObject({ kind: "invoice.paid", invoiceId: "in_1", amountMinor: 14900, currency: "EUR", hostedUrl: "https://invoice.stripe.com/i/1" })
  expect(mapStripeEvent(inv("invoice.payment_failed", { amount_due: 1234, amount_paid: 0 }))).toMatchObject({ kind: "invoice.payment_failed", amountMinor: 1234 })
  expect(mapStripeEvent(inv("invoice.paid", { hosted_invoice_url: "javascript:alert(1)" }))).toMatchObject({ hostedUrl: null })
  expect(mapStripeEvent(inv("invoice.paid", { amount_paid: 12.5 }))).toMatchObject({ kind: "ignored" }) // never a float
  expect(mapStripeEvent(inv("invoice.paid", { currency: undefined }))).toMatchObject({ kind: "ignored" }) // never an assumed currency
  expect(mapStripeEvent(inv("charge.refunded"))).toEqual({ kind: "ignored", providerEventId: "evt_2", type: "charge.refunded" })
})

test("retrieveSubscription maps the current provider state; unreadable -> throws", async () => {
  const p = mk()
  m.subRetrieve.mockResolvedValue(sub().data.object)
  expect(await p.retrieveSubscription("sub_1")).toMatchObject({ subscriptionId: "sub_1", customerId: "cus_1", status: "active", seats: 4, priceId: "price_1" })
  expect(m.subRetrieve).toHaveBeenCalledWith("sub_1")
  m.subRetrieve.mockResolvedValue({ id: "sub_1" })
  await expect(p.retrieveSubscription("sub_1")).rejects.toThrow()
})

test("retrieveInvoice: paid -> amount_paid, otherwise amount_due, integer minor units", async () => {
  const p = mk()
  m.invRetrieve.mockResolvedValue({ status: "paid", customer: "cus_1", amount_paid: 14900, amount_due: 0, currency: "eur" })
  expect(await p.retrieveInvoice("in_1")).toEqual({ invoiceId: "in_1", customerId: "cus_1", paid: true, amountMinor: 14900, currency: "EUR" })
  m.invRetrieve.mockResolvedValue({ status: "open", customer: "cus_1", amount_paid: 0, amount_due: 500, currency: "usd" })
  expect(await p.retrieveInvoice("in_1")).toMatchObject({ paid: false, amountMinor: 500, currency: "USD" })
  m.invRetrieve.mockResolvedValue({ status: "open", customer: "cus_1", amount_due: 5.5, currency: "usd" })
  await expect(p.retrieveInvoice("in_1")).rejects.toThrow()
})

test("listActiveSubscriptions drops canceled / incomplete_expired; expireCheckoutSession calls Stripe", async () => {
  const p = mk()
  m.subList.mockResolvedValue({ data: [{ id: "a", status: "active" }, { id: "b", status: "canceled" }, { id: "c", status: "incomplete_expired" }, { id: "d", status: "past_due" }] })
  expect(await p.listActiveSubscriptions("cus_1")).toEqual([{ id: "a", status: "active" }, { id: "d", status: "past_due" }])
  expect(m.subList).toHaveBeenCalledWith({ customer: "cus_1", status: "all", limit: 20 })
  await p.expireCheckoutSession("cs_1")
  expect(m.sessionsExpire).toHaveBeenCalledWith("cs_1")
})
