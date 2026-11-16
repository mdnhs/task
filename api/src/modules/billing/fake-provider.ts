import { InvalidSignatureError, type BillingEvent, type BillingProvider } from "./provider"

/** The only signature the fake accepts. */
export const FAKE_SIGNATURE = "fake-valid-signature"

type Call = { method: string; input: unknown }
export type FakeBillingProvider = BillingProvider & {
  calls: Call[]
  last(method: string): unknown
  /** Makes the next call to `method` reject (provider outage). */
  failNext(method: string): void
}

const DATE_FIELDS = ["createdAt", "currentPeriodEnd", "trialEnd", "periodStart", "periodEnd"]

/** In-memory provider for tests and local runs: records calls, accepts JSON webhook bodies signed with FAKE_SIGNATURE. */
export function fakeBilling(): FakeBillingProvider {
  const calls: Call[] = []
  const failing = new Set<string>()
  const rec = async <T>(method: string, input: unknown, out: T): Promise<T> => {
    calls.push({ method, input })
    if (failing.delete(method)) throw new Error("provider_down")
    return out
  }
  return {
    id: "fake",
    calls,
    last: (method) => [...calls].reverse().find((c) => c.method === method)?.input,
    failNext: (method) => void failing.add(method),
    ensureCustomer: (i) => rec("ensureCustomer", i, { customerId: `cus_fake_${i.tenantId.slice(0, 8)}` }),
    createCheckout: (i) => rec("createCheckout", i, { url: `https://billing.fake/checkout/${calls.length}`, sessionId: `cs_fake_${calls.length}` }),
    createPortal: (i) => rec("createPortal", i, { url: `https://billing.fake/portal/${i.customerId}` }),
    cancelAtPeriodEnd: (i) => rec("cancelAtPeriodEnd", i, undefined),
    resume: (i) => rec("resume", i, undefined),
    updateSeats: (i) => rec("updateSeats", i, undefined),
    parseWebhook: async (raw, signature) => {
      if (signature !== FAKE_SIGNATURE) throw new InvalidSignatureError()
      let o: Record<string, unknown>
      try {
        o = JSON.parse(raw) as Record<string, unknown>
      } catch {
        throw new InvalidSignatureError()
      }
      for (const f of DATE_FIELDS) if (typeof o[f] === "string") o[f] = new Date(o[f] as string)
      return o as unknown as BillingEvent
    },
  }
}
