import type { BillingProvider } from "./types"

// Mock Stripe: fake ids and URLs only. No network and no keys. A real implementation replaces
// the bodies (behind a server action) and keeps this shape.
export const stripeProvider: BillingProvider = {
  id: "stripe",
  label: "Stripe",
  async createCheckoutSession({ tenantId, planId }) {
    const sessionId = `cs_mock_${tenantId}_${planId}`
    return { sessionId, url: `https://checkout.stripe.test/c/pay/${sessionId}` }
  },
  async openCustomerPortal({ tenantId }) {
    const sessionId = `bps_mock_${tenantId}`
    return { sessionId, url: `https://billing.stripe.test/p/session/${sessionId}` }
  },
  async cancelSubscription() {
    return { status: "canceled", endsOn: null }
  },
  async resumeSubscription() {
    return { status: "active" }
  },
  async listPaymentMethods({ tenantId }) {
    return [{ id: `pm_mock_${tenantId}`, brand: "card", last4: "4242", isDefault: true }]
  },
}
