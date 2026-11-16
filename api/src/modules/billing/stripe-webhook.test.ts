import Stripe from "stripe"
import { beforeEach, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery } from "../../../test/db"
import { resetDb, testApp } from "../../../test/harness"
import { makeTenant } from "../../../test/factories"
import { resetSubscribers } from "../../core/events"
import { StripeBillingProvider } from "."

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
})

// Real stripe.webhooks.constructEvent against a test secret; no network (no API call is made).
const SECRET = "whsec_testsecret1234567890"
const stripe = new Stripe("sk_test_unused123456")
const provider = () => new StripeBillingProvider({ get: async () => ({ secretKey: "sk_test_unused123456", webhookSecret: SECRET }) })

const created = Math.floor(Date.now() / 1000)
const payload = (id: string, customer: string) =>
  JSON.stringify({
    id, object: "event", type: "invoice.paid", created,
    data: { object: { id: "in_real", customer, amount_paid: 14900, amount_due: 14900, currency: "eur", hosted_invoice_url: "https://invoice.stripe.com/i/real", period_start: created, period_end: created + 2_592_000 } },
  })
const sign = (body: string, secret = SECRET) => stripe.webhooks.generateTestHeaderString({ payload: body, secret })

async function setup() {
  const t = testApp({ billing: provider() })
  const tenant = await makeTenant(t.deps)
  await ownerQuery("insert into billing_customers (provider, customer_id, target_tenant_id) values ('stripe', 'cus_real', $1)", [tenant.id])
  const post = (body: string, sig?: string) => t.app.request("/webhooks/billing/stripe", { method: "POST", headers: sig ? { "stripe-signature": sig } : {}, body })
  return { ...t, tenant, post }
}

test("a correctly signed event is verified on the raw body, applied once, and redelivery is idempotent", async () => {
  const s = await setup()
  const body = payload("evt_real_1", "cus_real")
  expect((await s.post(body, sign(body))).status).toBe(200)
  expect((await s.post(body, sign(body))).status).toBe(200)
  const rows = await ownerTenantQuery(s.tenant.id, "select provider_invoice_id, amount_minor, currency, status from invoices")
  expect(rows).toEqual([{ provider_invoice_id: "in_real", amount_minor: "14900", currency: "EUR", status: "paid" }])
  expect(await ownerQuery("select provider from billing_events")).toEqual([{ provider: "stripe" }])
})

test("wrong secret, tampered body, missing header and a stale timestamp are all 400 invalid_signature with nothing stored", async () => {
  const s = await setup()
  const body = payload("evt_real_2", "cus_real")
  const stale = stripe.webhooks.generateTestHeaderString({ payload: body, secret: SECRET, timestamp: created - 3600 })
  for (const [b, sig] of [[body, sign(body, "whsec_other1234567890")], [body + " ", sign(body)], [body, undefined], [body, stale], [body, "garbage"]] as const) {
    const r = await s.post(b, sig)
    expect([r.status, ((await r.json()) as { code: string }).code]).toEqual([400, "invalid_signature"])
  }
  expect(await ownerQuery("select 1 from billing_events")).toEqual([])
  expect(await ownerTenantQuery(s.tenant.id, "select 1 from invoices")).toEqual([])
})
