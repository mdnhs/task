// The browser side of billing (B6 T6.4, ruling I20): every call goes through the BFF (apiBrowser). A hosted checkout or portal URL the API returns is
// followed, but only when it is an allowed provider host or a same-origin path (./redirect.ts). Seats are a LOCAL cap: no provider call, no navigation (ruling C10). Errors are ApiErrors: show userMessage(e).
import type { ApiClient } from "@/lib/api/client"
import { toSubscription } from "./adapters"
import { isAllowedRedirect } from "./redirect"
import type { Subscription } from "./types"

export type Navigator = { go: (url: string) => void }

function hostedUrl(res: { url: string }): string {
  if (!isAllowedRedirect(res.url)) throw new Error("billing: the provider returned a link that is not on an allowed host")
  return res.url
}

export function makeBillingClient(api: ApiClient, nav: Navigator) {
  return {
    async checkout(planId: string): Promise<void> {
      nav.go(hostedUrl(await api.post("/v1/billing/checkout", { body: { planId } })))
    },
    async portal(): Promise<void> {
      nav.go(hostedUrl(await api.post("/v1/billing/portal")))
    },
    async cancel(): Promise<Subscription> {
      return toSubscription(await api.post("/v1/billing/cancel"))
    },
    async resume(): Promise<Subscription> {
      return toSubscription(await api.post("/v1/billing/resume"))
    },
    async setSeats(seats: number): Promise<Subscription> {
      return toSubscription(await api.put("/v1/billing/seats", { body: { seats } }))
    },
  }
}
