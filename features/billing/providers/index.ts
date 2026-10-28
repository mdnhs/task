import { stripeProvider } from "./stripe"
import type { BillingProvider } from "./types"

const PROVIDERS: Record<string, BillingProvider> = { [stripeProvider.id]: stripeProvider }

/** Picks the implementation from the tenant billing data's `provider` field (case-insensitive). */
export function getBillingProvider(provider: string): BillingProvider {
  const found = PROVIDERS[provider.toLowerCase()]
  if (!found) throw new Error(`Unknown billing provider: ${provider}`)
  return found
}

export type { BillingProvider, PaymentMethod, RedirectResult } from "./types"
