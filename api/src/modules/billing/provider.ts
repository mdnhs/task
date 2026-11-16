import type { SubscriptionStatus } from "../../db/schema"

/**
 * Server-side twin of features/billing/providers/types.ts. A provider owns ALL knowledge of the payment network; the rest
 * of the API only sees these methods and BillingEvent. Deviation from the locked plan: parseWebhook is async because the
 * production provider resolves its (platform-admin managed) webhook secret from the database.
 */
export interface BillingProvider {
  readonly id: "stripe" | "fake"
  ensureCustomer(i: { tenantId: string; email: string; name: string }): Promise<{ customerId: string }>
  createCheckout(i: { customerId: string; priceId: string; seats: number; successUrl: string; cancelUrl: string; trialDays?: number }): Promise<{ url: string; sessionId: string }>
  createPortal(i: { customerId: string; returnUrl: string }): Promise<{ url: string }>
  cancelAtPeriodEnd(i: { subscriptionId: string }): Promise<void>
  resume(i: { subscriptionId: string }): Promise<void>
  updateSeats(i: { subscriptionId: string; seats: number }): Promise<void>
  /** Current provider state of a subscription (used to settle same-second event ties). Throws when it cannot be read. */
  retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot>
  /** Current provider state of an invoice (used to settle same-second event ties). Throws when it cannot be read. */
  retrieveInvoice(invoiceId: string): Promise<InvoiceSnapshot>
  /** The customer's subscriptions that are not dead (anything but canceled / incomplete_expired). */
  listActiveSubscriptions(customerId: string): Promise<{ id: string; status: string }[]>
  /** Expires an open checkout session so it can no longer be completed. */
  expireCheckoutSession(sessionId: string): Promise<void>
  /** Verifies the signature over the RAW body and maps the provider event. Throws InvalidSignatureError on any verification failure. */
  parseWebhook(rawBody: string, signature: string): Promise<BillingEvent>
  /** Drop cached provider config (called after the platform admin changes billing settings). */
  invalidate?(): void
}

export type BillingEvent =
  | { kind: "subscription.updated"; providerEventId: string; createdAt: Date; subscriptionId: string; customerId: string; status: SubscriptionStatus; priceId: string; seats: number; currentPeriodEnd: Date; cancelAtPeriodEnd: boolean; trialEnd: Date | null }
  | { kind: "invoice.paid" | "invoice.payment_failed"; providerEventId: string; createdAt: Date; invoiceId: string; customerId: string; amountMinor: number; currency: string; hostedUrl: string | null; periodStart: Date; periodEnd: Date }
  | { kind: "ignored"; providerEventId: string; type: string }

type SubEvent = Extract<BillingEvent, { kind: "subscription.updated" }>
export type SubscriptionSnapshot = Omit<SubEvent, "kind" | "providerEventId" | "createdAt">
export type InvoiceSnapshot = { invoiceId: string; customerId: string; paid: boolean; amountMinor: number; currency: string }

/** The signature header is missing, malformed, stale or does not match the body. Mapped to 400 invalid_signature. */
export class InvalidSignatureError extends Error {
  constructor() {
    super("invalid_signature")
    this.name = "InvalidSignatureError"
  }
}
