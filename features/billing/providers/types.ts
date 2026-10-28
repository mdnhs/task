export type PaymentMethod = { id: string; brand: string; last4: string; isDefault: boolean }
export type RedirectResult = { url: string; sessionId: string }

/**
 * Provider-agnostic billing contract. UI code calls only this interface; a new payment method
 * is a new implementation registered in `./index.ts`, with no change to the components.
 */
export interface BillingProvider {
  /** Stable key stored in the billing data (lowercase). */
  readonly id: string
  /** Display name shown in the UI and toasts. */
  readonly label: string
  /** Start a checkout session to move the tenant to another plan. */
  createCheckoutSession(input: { tenantId: string; planId: string }): Promise<RedirectResult>
  /** Open the provider's hosted customer portal. */
  openCustomerPortal(input: { tenantId: string }): Promise<RedirectResult>
  cancelSubscription(input: { tenantId: string }): Promise<{ status: "canceled"; endsOn: string | null }>
  resumeSubscription(input: { tenantId: string }): Promise<{ status: "active" }>
  listPaymentMethods(input: { tenantId: string }): Promise<PaymentMethod[]>
}
