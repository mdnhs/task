// The billing UI's own types (B6 T6.4). Prices are FLAT monthly amounts in integer MINOR units (cents) with an ISO currency: no floats anywhere.
export type PlanLimits = { activeUsers: number; storageGb: number; messages: number; transcriptionMinutes: number }
/** public/data/billing/plans.json: the static plan table the API reads too (display only; whole amounts in major units). */
export type Plan = { id: string; name: string; priceMonthly: number; currency: string; trialDays: number; limits: PlanLimits }

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused"
export type BillingState = "ok" | "grace" | "blocked"
/** GET /v1/billing/subscription, mapped. */
export type Subscription = {
  planId: string
  planName: string
  priceMinor: number
  currency: string
  status: SubscriptionStatus
  seats: number
  seatsUsed: number
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  billingState: BillingState
  graceEndsAt: string | null
  hasProviderSubscription: boolean
  hasCustomer: boolean
}

export type InvoiceStatus = "paid" | "failed" | "open"
/** GET /v1/billing/invoices item, mapped. `number` is the provider's invoice id; `hostedUrl` is an https link to the provider's invoice page, or null. */
export type Invoice = {
  id: string
  number: string
  amountMinor: number
  currency: string
  status: InvoiceStatus
  hostedUrl: string | null
  periodStart: string
  periodEnd: string
  createdAt: string
}

/** A plan card: the static table's plan with its price in minor units, whether it is the tenant's current plan, and how many product modules it includes. */
export type PlanCard = { id: string; name: string; priceMinor: number; currency: string; trialDays: number; limits: PlanLimits; current: boolean; modules: number }
