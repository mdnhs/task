import { describe, expect, test, vi } from "vitest"
import { fakeApi } from "@/test/support/fake-api"
import { toInvoice } from "./adapters"
import { makeBillingClient } from "./client"
import { PROVIDER_REDIRECT_HOSTS, isAllowedRedirect } from "./redirect"

// T6.4 carry-in 1: a checkout/portal/invoice link is followed only when it is a same-origin path or an https URL on a known payment-provider host.
describe("billing redirect allowlist", () => {
  test("the documented constant lists exactly the provider hosts", () => {
    expect([...PROVIDER_REDIRECT_HOSTS].sort()).toEqual(["billing.stripe.com", "checkout.stripe.com", "invoice.stripe.com", "pay.stripe.com"])
  })

  test.each([
    "https://checkout.stripe.com/c/pay/cs_1",
    "https://billing.stripe.com/p/session_1",
    "https://invoice.stripe.com/i/acct_1/in_1",
    "https://pay.stripe.com/invoice/x",
    "HTTPS://CHECKOUT.STRIPE.COM/c/pay/cs_1",
    "/settings/billing?checkout=done",
    "/settings/billing",
  ])("allows %s", (u) => expect(isAllowedRedirect(u)).toBe(true))

  test.each([
    ["an unrelated host", "https://evil.example/x"],
    ["a trailing look-alike", "https://checkout.stripe.com.evil.example/x"],
    ["a leading look-alike", "https://evilcheckout.stripe.com/x"],
    ["a sub-domain of a provider host", "https://x.checkout.stripe.com/x"],
    ["http", "http://checkout.stripe.com/c/pay/cs_1"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["protocol-relative", "//evil.example/x"],
    ["protocol-relative with backslash", "/\\evil.example/x"],
    ["backslash host", "https:\\\\checkout.stripe.com@evil.example"],
    ["userinfo trick", "https://checkout.stripe.com@evil.example/x"],
    ["credentials", "https://user:pw@checkout.stripe.com/x"],
    ["a custom port", "https://checkout.stripe.com:8443/x"],
    ["an empty string", ""],
    ["a bare word", "checkout.stripe.com"],
    ["a relative path without a slash", "settings/billing"],
    ["a path with a control character", "/a\nb"],
  ])("refuses %s", (_n, u) => expect(isAllowedRedirect(u)).toBe(false))

  test("checkout and portal never navigate to a refused URL", async () => {
    for (const url of ["https://evil.example", "https://checkout.stripe.com.evil.example/x", "https://evilcheckout.stripe.com/x", "http://checkout.stripe.com/x", "javascript:alert(1)", "//evil.example"]) {
      const { client } = fakeApi({ "POST /v1/billing/checkout": { url }, "POST /v1/billing/portal": { url } })
      const go = vi.fn()
      await expect(makeBillingClient(client, { go }).checkout("business")).rejects.toThrow()
      await expect(makeBillingClient(client, { go }).portal()).rejects.toThrow()
      expect(go, url).not.toHaveBeenCalled()
    }
  })

  test("a hosted invoice link on another host is dropped; a provider host is kept", () => {
    const inv = { id: "i1", providerInvoiceId: "in_1", amountMinor: 100, currency: "EUR", status: "paid", periodStart: "2026-11-17T00:00:00.000Z", periodEnd: "2026-12-17T00:00:00.000Z", createdAt: "2026-11-17T00:00:05.000Z" }
    expect(toInvoice({ ...inv, hostedUrl: "https://invoice.stripe.com/i/1" }).hostedUrl).toBe("https://invoice.stripe.com/i/1")
    expect(toInvoice({ ...inv, hostedUrl: "https://pay.stripe.com/invoice/1" }).hostedUrl).toBe("https://pay.stripe.com/invoice/1")
    expect(toInvoice({ ...inv, hostedUrl: "https://evil.example/i/1" }).hostedUrl).toBeNull()
    expect(toInvoice({ ...inv, hostedUrl: "https://invoice.stripe.com.evil.example/i/1" }).hostedUrl).toBeNull()
  })
})
