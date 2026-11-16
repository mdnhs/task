import { beforeEach, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { makeMember, makeStaff, makeTenant, signIn } from "../../../test/factories"
import { platformAuditEntries } from "../../../test/platform-audit"
import { buildKeyring, open } from "../../core/crypto/secret-box"
import { resetSubscribers } from "../../core/events"
import { sendNotification } from "../notifications"
import { testDb } from "../../../test/db"
import { FAKE_SIGNATURE, setBillingSettings, BILLING_SECRET_AAD, BILLING_WEBHOOK_AAD, StripeBillingProvider, type BillingEvent } from "."

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const DAY = 86_400_000
const T0 = new Date("2026-11-16T09:00:00Z")
const at = (days: number) => new Date(T0.getTime() + days * DAY)

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
})

const SECRET = "sk_test_51ExampleSecretKeyAbCdEf1234567890"
const WHSEC = "whsec_ExampleWebhookSigningSecret1234567890"
const PRICES = { starter: "price_starter1", business: "price_business1", enterprise: "price_enterprise1" }

async function world(sub: Parameters<typeof makeTenant>[1] extends infer O ? (O extends { subscription?: infer S } ? S : never) : never = {}) {
  const t = testApp()
  const tenant = await makeTenant(t.deps, { subscription: sub })
  const owner = await makeMember(t.deps, tenant.id, "owner")
  const admin = await makeMember(t.deps, tenant.id, "admin")
  const employee = await makeMember(t.deps, tenant.id, "employee")
  const [oc, ac, ec] = await Promise.all([owner, admin, employee].map((m) => signIn(t.app, m.email, m.password)))
  await setBillingSettings(t.deps.db, t.deps, { secretKey: SECRET, webhookSecret: WHSEC, priceMap: PRICES }, "platform-admin")
  return { ...t, tenant, owner, admin, employee, oc: oc.cookie, ac: ac.cookie, ec: ec.cookie }
}
type W = Awaited<ReturnType<typeof world>>
const req = (w: W, cookie: string, method: string, path: string, body?: unknown) => call(w.app, method, path, { cookie, tenant: w.tenant.slug, body })
const owner = (w: W, method: string, path: string, body?: unknown) => req(w, w.oc, method, path, body)
const code = async (r: Response) => ((await r.clone().json()) as Json).code

/** Links the tenant to a (fake) provider customer + subscription as a completed checkout would. */
async function link(w: W, customer = "cus_A", sub = "sub_A") {
  await ownerQuery("insert into billing_customers (provider, customer_id, target_tenant_id) values ('fake', $1, $2)", [customer, w.tenant.id])
  await ownerTenantQuery(w.tenant.id, "update subscriptions set provider = 'fake', provider_customer_id = $1, provider_subscription_id = $2", [customer, sub])
  return customer
}
const wh = (w: W, ev: unknown, signature: string | null = FAKE_SIGNATURE) =>
  Promise.resolve(w.app.request("/webhooks/billing/stripe", { method: "POST", headers: signature ? { "stripe-signature": signature } : {}, body: JSON.stringify(ev) }))

let evSeq = 0
const subEvent = (o: Partial<Extract<BillingEvent, { kind: "subscription.updated" }>> = {}): BillingEvent => ({
  kind: "subscription.updated", providerEventId: `evt_s${evSeq++}`, createdAt: at(0), subscriptionId: "sub_A", customerId: "cus_A", status: "active",
  priceId: PRICES.business, seats: 40, currentPeriodEnd: at(30), cancelAtPeriodEnd: false, trialEnd: null, ...o,
})
const invEvent = (o: Partial<Extract<BillingEvent, { kind: "invoice.paid" | "invoice.payment_failed" }>> = {}): BillingEvent => ({
  kind: "invoice.paid", providerEventId: `evt_i${evSeq++}`, createdAt: at(0), invoiceId: "in_1", customerId: "cus_A", amountMinor: 14900, currency: "EUR",
  hostedUrl: "https://invoice.stripe.com/i/in_1", periodStart: at(0), periodEnd: at(30), ...o,
})
const subRow = async (w: W) => (await ownerTenantQuery(w.tenant.id, "select * from subscriptions"))[0]
const invoicesOf = (w: W) => ownerTenantQuery(w.tenant.id, "select * from invoices order by created_at")
const billingNotes = (w: W) => ownerTenantQuery(w.tenant.id, "select user_id, title from notifications where kind = 'billing'")

// ---------------------------------------------------------------- tenant routes

test("checkout requires owner; admin gets 403 forbidden; success/cancel URLs are APP_URL-based", async () => {
  const w = await world()
  expect(await code(await req(w, w.ac, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 }))).toBe("forbidden")
  expect((await req(w, w.ec, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 })).status).toBe(403)
  const r = await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 })
  expect(r.status).toBe(200)
  expect(((await r.json()) as Json).url).toMatch(/^https:\/\/billing\.fake\/checkout\//)
  expect(w.billing.last("createCheckout")).toMatchObject({
    priceId: "price_business1", seats: 5, successUrl: `${testEnv.APP_URL}/settings/billing?status=success`, cancelUrl: `${testEnv.APP_URL}/settings/billing?status=cancelled`,
  })
  // the customer is created once, linked in the platform map and mirrored on the subscription
  expect(w.billing.last("ensureCustomer")).toMatchObject({ tenantId: w.tenant.id, email: w.owner.email })
  expect(await ownerQuery("select provider, customer_id from billing_customers")).toEqual([{ provider: "fake", customer_id: `cus_fake_${w.tenant.id.slice(0, 8)}` }])
  expect((await subRow(w)).provider_customer_id).toBe(`cus_fake_${w.tenant.id.slice(0, 8)}`)
  await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 })
  expect(w.billing.calls.filter((c) => c.method === "ensureCustomer")).toHaveLength(1)
})

test("checkout validation: seats >= active members, known + purchasable plan, one subscription per tenant", async () => {
  const w = await world()
  expect(await code(await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 2 }))).toBe("seats_below_members") // 3 active members
  expect((await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 2 })).status).toBe(422)
  expect(await code(await owner(w, "POST", "/v1/billing/checkout", { planId: "nope", seats: 5 }))).toBe("unknown_plan")
  await ownerQuery("update platform_billing_settings set price_map = '{}'")
  expect(await code(await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 }))).toBe("plan_not_purchasable")
  expect((await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 0 })).status).toBe(400)
  await ownerQuery("update platform_billing_settings set price_map = $1", [JSON.stringify(PRICES)])
  await link(w)
  expect(await code(await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 }))).toBe("already_subscribed")
  expect(w.billing.calls.filter((c) => c.method === "createCheckout")).toHaveLength(0)
})

test("a running trial carries into checkout as trialDays", async () => {
  const w = await world({ planId: "starter", status: "trialing", seats: 10, trialEndsAt: at(5) })
  await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 })
  expect(w.billing.last("createCheckout")).toMatchObject({ trialDays: 5 })
})

test("portal needs a customer; owner only; provider failure is 502 with no leak", async () => {
  const w = await world()
  expect(await code(await owner(w, "POST", "/v1/billing/portal"))).toBe("no_customer")
  await link(w)
  expect((await req(w, w.ac, "POST", "/v1/billing/portal")).status).toBe(403)
  const r = await owner(w, "POST", "/v1/billing/portal")
  expect(((await r.json()) as Json).url).toBe("https://billing.fake/portal/cus_A")
  expect(w.billing.last("createPortal")).toEqual({ customerId: "cus_A", returnUrl: `${testEnv.APP_URL}/settings/billing?status=portal` })
  w.billing.failNext("createPortal")
  const f = await owner(w, "POST", "/v1/billing/portal")
  expect([f.status, await code(f), JSON.stringify(await f.json())]).toEqual([502, "billing_provider_error", expect.not.stringContaining("provider_down")])
})

test("cancel sets cancel_at_period_end; resume clears it; both audited; owner only", async () => {
  const w = await world()
  expect(await code(await owner(w, "POST", "/v1/billing/cancel"))).toBe("no_subscription") // never subscribed
  await link(w)
  expect((await req(w, w.ac, "POST", "/v1/billing/cancel")).status).toBe(403)
  const c = await owner(w, "POST", "/v1/billing/cancel")
  expect(c.status).toBe(200)
  expect(((await c.json()) as Json).cancelAtPeriodEnd).toBe(true)
  expect(w.billing.last("cancelAtPeriodEnd")).toEqual({ subscriptionId: "sub_A" })
  expect((await subRow(w)).cancel_at_period_end).toBe(true)
  const r = await owner(w, "POST", "/v1/billing/resume")
  expect(((await r.json()) as Json).cancelAtPeriodEnd).toBe(false)
  expect(w.billing.last("resume")).toEqual({ subscriptionId: "sub_A" })
  const audit = await ownerTenantQuery(w.tenant.id, "select action, actor_id, before, after from audit_events where action = 'subscription.changed' order by seq")
  expect(audit.map((a) => [a.actor_id, (a.before as Json).cancelAtPeriodEnd, (a.after as Json).cancelAtPeriodEnd])).toEqual([[w.owner.userId, false, true], [w.owner.userId, true, false]])
  // idempotent: cancelling twice calls the provider once
  await owner(w, "POST", "/v1/billing/cancel")
  await owner(w, "POST", "/v1/billing/cancel")
  expect(w.billing.calls.filter((x) => x.method === "cancelAtPeriodEnd")).toHaveLength(2) // the first cancel + one after the resume; the repeat was a no-op
})

test("a blocked (canceled) tenant can still reach billing writes (not 402)", async () => {
  const w = await world({ status: "canceled" })
  await link(w)
  expect((await owner(w, "POST", "/v1/billing/portal")).status).toBe(200)
})

test("PUT /seats: owner only, never below active members, provider then local, audited", async () => {
  const w = await world()
  await link(w)
  expect((await req(w, w.ac, "PUT", "/v1/billing/seats", { seats: 20 })).status).toBe(403)
  expect(await code(await owner(w, "PUT", "/v1/billing/seats", { seats: 2 }))).toBe("seats_below_members")
  expect(w.billing.calls.filter((c) => c.method === "updateSeats")).toHaveLength(0)
  const r = await owner(w, "PUT", "/v1/billing/seats", { seats: 25 })
  expect(r.status).toBe(200)
  expect(((await r.json()) as Json).seats).toBe(25)
  expect(w.billing.last("updateSeats")).toEqual({ subscriptionId: "sub_A", seats: 25 })
  expect((await subRow(w)).seats).toBe(25)
  w.billing.failNext("updateSeats")
  expect((await owner(w, "PUT", "/v1/billing/seats", { seats: 30 })).status).toBe(502)
  expect((await subRow(w)).seats).toBe(25) // local state untouched when the provider failed
})

test("GET /subscription and /invoices: owner and admin read, others 403; invoices paginate newest first", async () => {
  const w = await world()
  await link(w)
  expect((await req(w, w.ec, "GET", "/v1/billing/subscription")).status).toBe(403)
  expect((await req(w, w.ec, "GET", "/v1/billing/invoices")).status).toBe(403)
  const s = (await (await req(w, w.ac, "GET", "/v1/billing/subscription")).json()) as Json
  expect(s).toMatchObject({ planId: "business", planName: "Business", priceMonthlyMinor: 14900, currency: "EUR", status: "active", seats: 40, seatsUsed: 3, hasProviderSubscription: true, hasCustomer: true, billingState: "ok" })
  for (let i = 0; i < 5; i++) await wh(w, invEvent({ invoiceId: `in_${i}`, createdAt: at(i), amountMinor: 1000 + i }))
  const p1 = (await (await req(w, w.oc, "GET", "/v1/billing/invoices?limit=2")).json()) as Json
  expect(p1.items.map((i: Json) => i.providerInvoiceId)).toEqual(["in_4", "in_3"])
  expect(p1.nextCursor).toEqual(expect.any(String))
  const p2 = (await (await req(w, w.oc, "GET", `/v1/billing/invoices?limit=2&cursor=${p1.nextCursor}`)).json()) as Json
  expect(p2.items.map((i: Json) => i.providerInvoiceId)).toEqual(["in_2", "in_1"])
  const p3 = (await (await req(w, w.oc, "GET", `/v1/billing/invoices?limit=2&cursor=${p2.nextCursor}`)).json()) as Json
  expect(p3.items.map((i: Json) => i.providerInvoiceId)).toEqual(["in_0"])
  expect(p3.nextCursor).toBeNull()
  expect(p1.items[0]).toMatchObject({ amountMinor: 1004, currency: "EUR", status: "paid", hostedUrl: "https://invoice.stripe.com/i/in_1" })
  expect(await code(await req(w, w.oc, "GET", "/v1/billing/invoices?cursor=garbage"))).toBe("invalid_cursor")
})

test("invoices are tenant-isolated (RLS)", async () => {
  const a = await world()
  const b = await world()
  await link(a, "cus_A", "sub_A")
  await link(b, "cus_B", "sub_B")
  await wh(a, invEvent({ invoiceId: "in_a", customerId: "cus_A" }))
  await wh(b, invEvent({ invoiceId: "in_b", customerId: "cus_B" }))
  expect((await invoicesOf(a)).map((r) => r.provider_invoice_id)).toEqual(["in_a"])
  expect((await invoicesOf(b)).map((r) => r.provider_invoice_id)).toEqual(["in_b"])
  const seenByA = (await (await req(a, a.oc, "GET", "/v1/billing/invoices")).json()) as Json
  expect(seenByA.items.map((i: Json) => i.providerInvoiceId)).toEqual(["in_a"])
})

// ---------------------------------------------------------------- webhook pipeline

test("webhook with a bad signature -> 400 invalid_signature and nothing stored", async () => {
  const w = await world()
  await link(w)
  const bad = await wh(w, invEvent(), "nope")
  expect([bad.status, await code(bad)]).toEqual([400, "invalid_signature"])
  expect(bad.headers.get("content-type")).toMatch(/problem\+json/)
  const missing = await wh(w, invEvent(), null)
  expect([missing.status, await code(missing)]).toEqual([400, "invalid_signature"])
  expect(await ownerQuery("select 1 from billing_events")).toEqual([])
  expect(await invoicesOf(w)).toEqual([])
})

test("webhook idempotent and out-of-order safe", async () => {
  const w = await world()
  await link(w)
  const paid = invEvent({ providerEventId: "evt_1" })
  expect((await wh(w, paid)).status).toBe(200)
  expect((await wh(w, paid)).status).toBe(200)
  expect(await invoicesOf(w)).toHaveLength(1)
  expect(await ownerQuery("select 1 from billing_events where provider_event_id = 'evt_1'")).toHaveLength(1)
  const failed = invEvent({ kind: "invoice.payment_failed", invoiceId: "in_2", providerEventId: "evt_2" })
  await wh(w, failed)
  await wh(w, failed)
  expect(await billingNotes(w)).toHaveLength(1) // owner only (the single owner), once

  // newer first, then the older: the older never overwrites
  await wh(w, subEvent({ providerEventId: "evt_new", createdAt: at(2), status: "active" }))
  await wh(w, subEvent({ providerEventId: "evt_old", createdAt: at(1), status: "past_due" }))
  expect((await subRow(w)).status).toBe("active")
  // ...and the older one is still recorded (it was received), not re-applied on redelivery
  expect(await ownerQuery("select 1 from billing_events where provider_event_id = 'evt_old'")).toHaveLength(1)
})

test("concurrent duplicate deliveries apply once", async () => {
  const w = await world()
  await link(w)
  const failed = invEvent({ kind: "invoice.payment_failed", invoiceId: "in_c", providerEventId: "evt_dup" })
  const rs = await Promise.all([wh(w, failed), wh(w, failed), wh(w, failed)])
  expect(rs.map((r) => r.status)).toEqual([200, 200, 200])
  expect(await invoicesOf(w)).toHaveLength(1)
  expect(await billingNotes(w)).toHaveLength(1)
})

test("invoice.payment_failed -> subscription past_due (writes stay open), owners notified, dunning once per invoice", async () => {
  const w = await world()
  await link(w)
  await wh(w, invEvent({ kind: "invoice.payment_failed", invoiceId: "in_f", providerEventId: "evt_f1", amountMinor: 14900, createdAt: at(1) }))
  await wh(w, subEvent({ status: "past_due", createdAt: at(1) }))
  expect((await subRow(w)).status).toBe("past_due")
  expect((await invoicesOf(w))[0]).toMatchObject({ status: "failed", amount_minor: "14900" })
  const notes = await billingNotes(w)
  expect(notes).toEqual([{ user_id: w.owner.userId, title: "Payment failed" }])
  // Stripe retries the same invoice (a new event id): the owner is not told again
  await wh(w, invEvent({ kind: "invoice.payment_failed", invoiceId: "in_f", providerEventId: "evt_f2", createdAt: at(2) }))
  expect(await billingNotes(w)).toHaveLength(1)
  // the dunning email is one queued delivery
  const deliveries = await ownerTenantQuery(w.tenant.id, "select channel from notification_deliveries")
  expect(deliveries.filter((d) => d.channel === "email")).toHaveLength(1)
  expect(w.queue.jobs.filter((j) => j.name === "notification.send")).toHaveLength(1)
  await w.queue.drain((_name, data) => sendNotification(data, w.deps))
  expect(w.mailer.sent.filter((m) => m.to === w.owner.email && m.subject === "Payment failed")).toHaveLength(1)
  // a different invoice failing is a new dunning notice
  await wh(w, invEvent({ kind: "invoice.payment_failed", invoiceId: "in_g", providerEventId: "evt_g", createdAt: at(3) }))
  expect(await billingNotes(w)).toHaveLength(2)
  // writes stay open during dunning
  expect((await owner(w, "POST", "/v1/_probe/write")).status).toBe(200)
  // billing.payment_failed was published (audit first, publish last)
  expect((await ownerTenantQuery(w.tenant.id, "select 1 from domain_events where type = 'billing.payment_failed'")).length).toBe(2)
  expect((await ownerTenantQuery(w.tenant.id, "select 1 from audit_events where action = 'invoice.payment_failed' and actor_id = 'system:billing'")).length).toBe(2)
})

test("a stale payment_failed never overrides a newer paid invoice", async () => {
  const w = await world()
  await link(w)
  await wh(w, invEvent({ invoiceId: "in_s", createdAt: at(2) }))
  await wh(w, invEvent({ kind: "invoice.payment_failed", invoiceId: "in_s", createdAt: at(1) }))
  expect((await invoicesOf(w))[0].status).toBe("paid")
  expect(await billingNotes(w)).toEqual([])
})

test("subscription.updated changes plan -> entitlements invalidated immediately (no TTL wait); webhook changes audited as system:billing", async () => {
  const w = await world({ planId: "starter", seats: 10 })
  await link(w)
  expect((await owner(w, "GET", "/v1/_probe/m1a")).status).toBe(403) // starter: cached now
  const r = await wh(w, subEvent({ priceId: PRICES.business, seats: 40, createdAt: at(1) }))
  expect(r.status).toBe(200)
  expect((await owner(w, "GET", "/v1/_probe/m1a")).status).toBe(200) // same clock instant: no 60 s wait
  expect(await subRow(w)).toMatchObject({ plan_id: "business", seats: 40, status: "active", provider_subscription_id: "sub_A" })
  const audit = await ownerTenantQuery(w.tenant.id, "select actor_id, before, after from audit_events where action = 'subscription.changed'")
  expect(audit).toHaveLength(1)
  expect(audit[0]).toMatchObject({ actor_id: "system:billing" })
  expect((audit[0].before as Json).planId).toBe("starter")
  expect((audit[0].after as Json).planId).toBe("business")
  expect(await ownerTenantQuery(w.tenant.id, "select 1 from domain_events where type = 'billing.subscription_changed'")).toHaveLength(1)
})

test("unknown event types are recorded as ignored and return 200; unknown customer too", async () => {
  const w = await world()
  await link(w)
  const r = await wh(w, { kind: "ignored", providerEventId: "evt_x", type: "charge.refunded" })
  expect(r.status).toBe(200)
  expect(await ownerQuery("select kind, target_tenant_id from billing_events where provider_event_id = 'evt_x'")).toEqual([{ kind: "ignored", target_tenant_id: null }])
  const u = await wh(w, invEvent({ customerId: "cus_UNKNOWN", providerEventId: "evt_u" }))
  expect(u.status).toBe(200)
  expect(await ownerQuery("select kind from billing_events where provider_event_id = 'evt_u'")).toEqual([{ kind: "ignored" }])
  expect(await invoicesOf(w)).toEqual([])
})

test("Stripe status mapping: unpaid and paused block writes; past_due does not", async () => {
  const w = await world()
  await link(w)
  let n = 1
  for (const [status, blocked] of [["unpaid", true], ["paused", true], ["past_due", false], ["active", false], ["canceled", true]] as const) {
    await wh(w, subEvent({ status, createdAt: at(n++) }))
    expect((await subRow(w)).status).toBe(status)
    expect((await owner(w, "POST", "/v1/_probe/write")).status).toBe(blocked ? 402 : 200)
  }
})

test("incomplete keeps a running trial (no SCA lockout); without a trial it is incomplete", async () => {
  const w = await world({ planId: "starter", status: "trialing", seats: 10, trialEndsAt: at(5) })
  await link(w)
  await wh(w, subEvent({ status: "incomplete", priceId: PRICES.starter, createdAt: at(1), trialEnd: null }))
  expect(await subRow(w)).toMatchObject({ status: "trialing" })
  expect((await subRow(w)).trial_ends_at).toEqual(at(5))
  expect((await owner(w, "POST", "/v1/_probe/write")).status).toBe(200)
  const x = await world({ planId: "starter", status: "trialing", seats: 10, trialEndsAt: at(-1) })
  await link(x, "cus_X", "sub_X")
  await wh(x, subEvent({ customerId: "cus_X", subscriptionId: "sub_X", status: "incomplete", priceId: PRICES.starter, createdAt: at(1) }))
  expect((await subRow(x)).status).toBe("incomplete")
  const y = await world({ planId: "starter", status: "active", seats: 10 })
  await link(y, "cus_Y", "sub_Y")
  await wh(y, subEvent({ customerId: "cus_Y", subscriptionId: "sub_Y", status: "incomplete", priceId: PRICES.starter, createdAt: at(1) }))
  expect((await subRow(y)).status).toBe("incomplete")
})

test("a canceled event for a superseded subscription does not cancel the tenant", async () => {
  const w = await world()
  await link(w, "cus_A", "sub_NEW")
  await wh(w, subEvent({ subscriptionId: "sub_OLD", status: "canceled", createdAt: at(1) }))
  expect((await subRow(w)).status).toBe("active")
  expect((await subRow(w)).provider_subscription_id).toBe("sub_NEW")
})

test("amounts are integer minor units; currency comes from the provider, never assumed", async () => {
  const w = await world()
  await link(w)
  await wh(w, invEvent({ invoiceId: "in_jpy", amountMinor: 5000, currency: "JPY", createdAt: at(1) }))
  await wh(w, invEvent({ invoiceId: "in_usd", amountMinor: 1999, currency: "USD", hostedUrl: null, createdAt: at(2) }))
  const rows = await invoicesOf(w)
  expect(rows.map((r) => [r.provider_invoice_id, Number(r.amount_minor), r.currency, r.hosted_url])).toEqual([["in_jpy", 5000, "JPY", "https://invoice.stripe.com/i/in_1"], ["in_usd", 1999, "USD", null]])
  expect(Number.isInteger(Number(rows[0].amount_minor))).toBe(true)
  expect((await ownerTenantQuery(w.tenant.id, "select data_type from information_schema.columns where table_name = 'invoices' and column_name = 'amount_minor'"))[0].data_type).toBe("bigint")
  await expect(ownerTenantQuery(w.tenant.id, "insert into invoices (tenant_id, provider_invoice_id, amount_minor, currency, status, period_start, period_end, event_at, created_at) values ($1, 'x', -1, 'EUR', 'paid', now(), now(), now(), now())", [w.tenant.id])).rejects.toBeDefined()
})

// ---------------------------------------------------------------- platform settings

async function staffWorld() {
  const t = testApp()
  const [ownerS, billing, support, viewer] = await Promise.all([makeStaff(t.deps, "owner"), makeStaff(t.deps, "billing"), makeStaff(t.deps, "support"), makeStaff(t.deps, "viewer")])
  const tenant = await makeTenant(t.deps)
  const tm = await makeMember(t.deps, tenant.id, "owner")
  const tenantCookie = (await signIn(t.app, tm.email, tm.password)).cookie
  return { ...t, ownerS, billing, support, viewer, tenantCookie }
}
const body = { secretKey: SECRET, webhookSecret: WHSEC, publishableKey: "pk_test_51ExamplePublishableKey", priceMap: { starter: "price_s1x", business: "price_b1x" } }

test("platform billing settings: owner and billing staff only; never return secrets; same-tx audit without secrets", async () => {
  const s = await staffWorld()
  const r = (cookie: string, method: string, b?: unknown) => call(s.app, method, "/v1/platform/settings/billing", { cookie, body: b })
  expect(await (await r(s.ownerS.cookie!, "GET")).json()).toEqual({ configured: false })
  for (const who of [s.support, s.viewer]) expect((await r(who.cookie!, "GET")).status).toBe(403)
  expect((await r(s.tenantCookie, "GET")).status).toBe(404) // a tenant owner is not platform staff
  expect((await r(s.support.cookie!, "PUT", body)).status).toBe(403)
  const put = await r(s.billing.cookie!, "PUT", body)
  expect(put.status).toBe(200)
  const text = await put.clone().text()
  expect(text).not.toContain(SECRET)
  expect(text).not.toContain(WHSEC)
  expect((await put.json()) as Json).toMatchObject({
    configured: true, provider: "stripe", secretKeyLast4: "7890", webhookSecretLast4: "7890", publishableKey: body.publishableKey, priceMap: body.priceMap,
    webhookUrl: `${testEnv.APP_URL}/webhooks/billing/stripe`, updatedBy: s.billing.userId,
  })
  expect(JSON.stringify(await (await r(s.ownerS.cookie!, "GET")).json())).not.toContain("ciphertext")
  // sealed with the purpose AADs, bound to their columns
  const [row] = await ownerQuery("select secret_key_ciphertext as k, webhook_secret_ciphertext as w from platform_billing_settings")
  const ring = buildKeyring(testEnv)
  expect(BILLING_SECRET_AAD).toBe("platform.billing.stripe.secret_key")
  expect(BILLING_WEBHOOK_AAD).toBe("platform.billing.stripe.webhook_secret")
  expect(open(String(row.k), ring, BILLING_SECRET_AAD)).toBe(SECRET)
  expect(open(String(row.w), ring, BILLING_WEBHOOK_AAD)).toBe(WHSEC)
  expect(() => open(String(row.k), ring, BILLING_WEBHOOK_AAD)).toThrow()
  expect(String(row.k)).not.toContain(SECRET)
  const audit = await platformAuditEntries()
  expect(audit.filter((a) => a.action === "platform.billing_settings.updated")).toHaveLength(1)
  expect(audit[audit.length - 1]).toMatchObject({ actorId: s.billing.userId })
  expect(JSON.stringify(audit)).not.toContain(SECRET)
  expect(JSON.stringify(audit)).not.toContain(WHSEC)
})

test("platform billing settings: first save needs both secrets, later partial update keeps them, validation, unknown plan", async () => {
  const s = await staffWorld()
  const put = (b: unknown) => call(s.app, "PUT", "/v1/platform/settings/billing", { cookie: s.ownerS.cookie!, body: b })
  expect(await code(await put({ priceMap: {} }))).toBe("secret_required")
  expect(await code(await put({ ...body, secretKey: "nope" }))).toBe("invalid_secret_key")
  expect(await code(await put({ ...body, webhookSecret: "nope" }))).toBe("invalid_webhook_secret")
  expect(await code(await put({ ...body, publishableKey: "nope" }))).toBe("invalid_publishable_key")
  expect(await code(await put({ ...body, priceMap: { starter: "nope" } }))).toBe("invalid_price_id")
  expect(await code(await put({ ...body, priceMap: { ghost: "price_g1x" } }))).toBe("unknown_plan")
  expect(await ownerQuery("select 1 from platform_billing_settings")).toEqual([])
  expect((await put(body)).status).toBe(200)
  const [before] = await ownerQuery("select secret_key_ciphertext as k from platform_billing_settings")
  expect((await put({ priceMap: { enterprise: "price_e1x" } })).status).toBe(200)
  const [after] = await ownerQuery("select secret_key_ciphertext as k, price_map from platform_billing_settings")
  expect(after.k).toBe(before.k)
  expect(after.price_map).toEqual({ enterprise: "price_e1x" })
})

test("unconfigured: billing writes and the webhook answer 503 billing_not_configured (no fake fallback)", async () => {
  const t = testApp({ billing: new StripeBillingProvider({ get: async () => null }) })
  const tenant = await makeTenant(t.deps)
  const o = await makeMember(t.deps, tenant.id, "owner")
  const { cookie } = await signIn(t.app, o.email, o.password)
  await setBillingSettings(t.deps.db, { ...t.deps, billing: { id: "fake", invalidate() {} } as never }, { secretKey: SECRET, webhookSecret: WHSEC, priceMap: PRICES }, "pa")
  const co = await call(t.app, "POST", "/v1/billing/checkout", { cookie, tenant: tenant.slug, body: { planId: "business", seats: 1 } })
  expect([co.status, await code(co)]).toEqual([503, "billing_not_configured"])
  const hook = await t.app.request("/webhooks/billing/stripe", { method: "POST", headers: { "stripe-signature": "t=1,v1=x" }, body: "{}" })
  expect([hook.status, await code(hook)]).toEqual([503, "billing_not_configured"])
  expect((await call(t.app, "GET", "/v1/billing/subscription", { cookie, tenant: tenant.slug })).status).toBe(200) // reads need no provider
})

// ---------------------------------------------------------------- fix round 1

const snapshot = (o: Record<string, unknown> = {}) => ({ subscriptionId: "sub_A", customerId: "cus_A", status: "active" as const, priceId: PRICES.business, seats: 40, currentPeriodEnd: at(30), cancelAtPeriodEnd: false, trialEnd: null, ...o })

test("I1: same-second incomplete -> active pair ends ACTIVE in either delivery order (provider state settles the tie)", async () => {
  for (const order of ["created-first", "updated-first"] as const) {
    await resetDb()
    const w = await world({ planId: "business", status: "active" })
    await link(w)
    w.billing.subscriptions.set("sub_A", snapshot())
    const created = subEvent({ providerEventId: `evt_c_${order}`, createdAt: at(1), status: "incomplete" })
    const updated = subEvent({ providerEventId: `evt_u_${order}`, createdAt: at(1), status: "active" })
    for (const e of order === "created-first" ? [created, updated] : [updated, created]) expect((await wh(w, e)).status).toBe(200)
    expect((await subRow(w)).status, order).toBe("active")
    expect((await owner(w, "POST", "/v1/_probe/write")).status, order).toBe(200)
    expect(w.billing.calls.filter((c) => c.method === "retrieveSubscription"), order).toHaveLength(1) // only the tied event asked
  }
})

test("I1: a strictly older event is still ignored (no provider call); a failed retrieve is a 5xx and the retry succeeds", async () => {
  const w = await world()
  await link(w)
  await wh(w, subEvent({ createdAt: at(2), status: "active" }))
  await wh(w, subEvent({ createdAt: at(1), status: "past_due" }))
  expect((await subRow(w)).status).toBe("active")
  expect(w.billing.calls.filter((c) => c.method === "retrieveSubscription")).toHaveLength(0)
  const tie = subEvent({ providerEventId: "evt_tie", createdAt: at(2), status: "past_due" })
  w.billing.subscriptions.set("sub_A", snapshot({ status: "unpaid" }))
  w.billing.failNext("retrieveSubscription")
  expect((await wh(w, tie)).status).toBe(500)
  expect(await ownerQuery("select 1 from billing_events where provider_event_id = 'evt_tie'")).toEqual([]) // nothing recorded: Stripe retries
  expect((await wh(w, tie)).status).toBe(200)
  expect((await subRow(w)).status).toBe("unpaid") // the provider's current state, not the event's
})

test("I1: a same-second invoice tie (failed then paid) is settled by the provider's invoice state", async () => {
  const w = await world()
  await link(w)
  await wh(w, invEvent({ kind: "invoice.payment_failed", invoiceId: "in_t", providerEventId: "evt_t1", createdAt: at(1) }))
  expect((await invoicesOf(w))[0].status).toBe("failed")
  w.billing.invoices.set("in_t", { invoiceId: "in_t", customerId: "cus_A", paid: true, amountMinor: 14900, currency: "EUR" })
  await wh(w, invEvent({ invoiceId: "in_t", providerEventId: "evt_t2", createdAt: at(1) }))
  expect((await invoicesOf(w))[0].status).toBe("paid")
  expect(w.billing.calls.filter((c) => c.method === "retrieveInvoice")).toHaveLength(1)
})

test("I2: a second checkout while the provider reports a live subscription is 409 subscription_exists (no session created)", async () => {
  const w = await world()
  w.billing.active.set(`cus_fake_${w.tenant.id.slice(0, 8)}`, [{ id: "sub_live", status: "active" }])
  const r = await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 })
  expect([r.status, await code(r)]).toEqual([409, "subscription_exists"])
  expect(w.billing.calls.filter((c) => c.method === "createCheckout")).toHaveLength(0)
})

test("I2: a second checkout expires the previous open session and remembers the new one", async () => {
  const w = await world()
  const first = (await (await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 })).json()) as Json
  void first
  const s1 = (await subRow(w)).checkout_session_id as string
  expect(s1).toMatch(/^cs_fake_/)
  expect(w.billing.calls.filter((c) => c.method === "expireCheckoutSession")).toHaveLength(0)
  expect((await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 })).status).toBe(200)
  expect(w.billing.last("expireCheckoutSession")).toEqual({ sessionId: s1 })
  const s2 = (await subRow(w)).checkout_session_id as string
  expect(s2).not.toBe(s1)
  // an expire that fails (session already completed/expired) never blocks a new checkout
  w.billing.failNext("expireCheckoutSession")
  expect((await owner(w, "POST", "/v1/billing/checkout", { planId: "business", seats: 5 })).status).toBe(200)
})

test("I2: a webhook for subscription Y while X is live leaves the row on X (ignored.foreign_subscription, 200); after X is canceled Y is adopted", async () => {
  const w = await world()
  await link(w, "cus_A", "sub_X")
  const r = await wh(w, subEvent({ providerEventId: "evt_y1", subscriptionId: "sub_Y", seats: 99, createdAt: at(1) }))
  expect(r.status).toBe(200)
  expect(await subRow(w)).toMatchObject({ provider_subscription_id: "sub_X", seats: 40, status: "active" })
  expect(await ownerQuery("select kind from billing_events where provider_event_id = 'evt_y1'")).toEqual([{ kind: "ignored.foreign_subscription" }])
  await ownerTenantQuery(w.tenant.id, "update subscriptions set status = 'canceled'")
  expect((await wh(w, subEvent({ providerEventId: "evt_y2", subscriptionId: "sub_Y", seats: 99, createdAt: at(2) }))).status).toBe(200)
  expect(await subRow(w)).toMatchObject({ provider_subscription_id: "sub_Y", seats: 99, status: "active", checkout_session_id: null })
})

test("M1: webhook bodies over 256 KB are 413 problem+json before any parsing", async () => {
  const w = await world()
  const r = await wh(w, { kind: "ignored", providerEventId: "evt_big", type: "x", pad: "x".repeat(300_000) })
  expect([r.status, await code(r)]).toEqual([413, "payload_too_large"])
  expect(r.headers.get("content-type")).toMatch(/problem\+json/)
  expect(await ownerQuery("select 1 from billing_events")).toEqual([])
})

test("M2: ledger dedupe: the same event id delivered twice adds no audit row, no event, no notification and answers 200", async () => {
  const w = await world()
  await link(w)
  const ev = subEvent({ providerEventId: "evt_dedupe", createdAt: at(1), status: "past_due" })
  const fail = invEvent({ kind: "invoice.payment_failed", invoiceId: "in_d", providerEventId: "evt_dedupe_i", createdAt: at(1) })
  expect((await wh(w, ev)).status).toBe(200)
  expect((await wh(w, fail)).status).toBe(200)
  const count = async () => ({
    audit: (await ownerTenantQuery(w.tenant.id, "select 1 from audit_events")).length,
    events: (await ownerTenantQuery(w.tenant.id, "select 1 from domain_events")).length,
    notes: (await billingNotes(w)).length,
    ledger: (await ownerQuery("select 1 from billing_events")).length,
  })
  const before = await count()
  expect(before.notes).toBe(1)
  expect((await wh(w, ev)).status).toBe(200)
  expect((await wh(w, fail)).status).toBe(200)
  expect(await count()).toEqual(before)
  // the in-tx ON CONFLICT guard also holds when the fast path is bypassed (a concurrent first delivery)
  const rs = await Promise.all([wh(w, ev), wh(w, ev)])
  expect(rs.map((r) => r.status)).toEqual([200, 200])
  expect(await count()).toEqual(before)
})

test("M3: billing_customers is append-only for app_user (no UPDATE, no DELETE); inserts still work", async () => {
  const w = await world()
  await link(w)
  const db = testDb()
  await expect(db.$client.query("update billing_customers set customer_id = 'x'")).rejects.toMatchObject({ code: "42501" })
  await expect(db.$client.query("delete from billing_customers")).rejects.toMatchObject({ code: "42501" })
  await expect(db.$client.query("truncate billing_customers")).rejects.toMatchObject({ code: "42501" })
  expect((await ownerQuery("select 1 from billing_customers")).length).toBe(1)
  await db.$client.query("insert into billing_customers (provider, customer_id, target_tenant_id) values ('fake', 'cus_new', $1)", [w.tenant.id])
  expect((await ownerQuery("select 1 from billing_customers")).length).toBe(2)
})
