import Stripe from "stripe"
import { AppError } from "../../core/errors"
import type { SubscriptionStatus } from "../../db/schema"
import { InvalidSignatureError, type BillingEvent, type BillingProvider, type InvoiceSnapshot, type SubscriptionSnapshot } from "./provider"

export type StripeConfig = { secretKey: string; webhookSecret: string }
export type StripeConfigSource = { get(): Promise<StripeConfig | null>; invalidate?(): void }

const notConfigured = () => new AppError(503, "billing_not_configured", "Service Unavailable")

/** Stripe subscription status -> ours. Unknown statuses are not mapped (the event is ignored, never guessed). */
const STATUS: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  unpaid: "unpaid",
  canceled: "canceled",
  incomplete: "incomplete",
  incomplete_expired: "canceled",
  paused: "paused",
}
export const mapStripeStatus = (s: unknown): SubscriptionStatus | null => (typeof s === "string" && Object.hasOwn(STATUS, s) ? STATUS[s] : null)

const date = (sec: unknown): Date | null => (typeof sec === "number" && Number.isFinite(sec) ? new Date(sec * 1000) : null)
const idOf = (v: unknown): string | null => (typeof v === "string" ? v : typeof (v as { id?: unknown } | null)?.id === "string" ? (v as { id: string }).id : null)
const https = (v: unknown): string | null => (typeof v === "string" && v.startsWith("https://") ? v : null)

type SubObj = {
  id?: unknown; customer?: unknown; status?: unknown; cancel_at_period_end?: unknown; trial_end?: unknown; current_period_end?: unknown
  items?: { data?: { quantity?: unknown; price?: { id?: unknown }; current_period_end?: unknown }[] }
}
type InvObj = {
  id?: unknown; customer?: unknown; amount_paid?: unknown; amount_due?: unknown; currency?: unknown; hosted_invoice_url?: unknown; period_start?: unknown; period_end?: unknown
  lines?: { data?: { period?: { start?: unknown; end?: unknown } }[] }
}

/** Stripe subscription object -> our snapshot, or null when it lacks a field we need or has an unknown status. */
export function mapStripeSubscription(obj: unknown): SubscriptionSnapshot | null {
  const s = obj as SubObj
  const item = s.items?.data?.[0]
  const subscriptionId = idOf(s.id)
  const customerId = idOf(s.customer)
  const status = mapStripeStatus(s.status)
  const priceId = typeof item?.price?.id === "string" ? item.price.id : null
  // Stripe moved the period end onto the item (2025+ API versions); older versions have it on the subscription.
  const periodEnd = date(item?.current_period_end ?? s.current_period_end)
  if (!subscriptionId || !customerId || !status || !priceId || !periodEnd) return null
  const qty = item?.quantity
  return {
    subscriptionId, customerId, status, priceId, seats: typeof qty === "number" && Number.isInteger(qty) && qty >= 0 ? qty : 1,
    currentPeriodEnd: periodEnd, cancelAtPeriodEnd: s.cancel_at_period_end === true, trialEnd: date(s.trial_end),
  }
}

/**
 * Maps a VERIFIED Stripe event to a BillingEvent. Anything we do not act on, or that lacks a field we need, becomes
 * { kind: "ignored" } (recorded, answered 200): a malformed event must never turn into a retry storm or a bad write.
 */
export function mapStripeEvent(evt: { id: string; type: string; created: number; data: { object: unknown } }): BillingEvent {
  const base = { providerEventId: evt.id, createdAt: new Date(evt.created * 1000) }
  const ignored: BillingEvent = { kind: "ignored", providerEventId: evt.id, type: evt.type }
  if (evt.type === "customer.subscription.created" || evt.type === "customer.subscription.updated" || evt.type === "customer.subscription.deleted") {
    const snap = mapStripeSubscription(evt.data.object)
    return snap ? { kind: "subscription.updated", ...base, ...snap } : ignored
  }
  if (evt.type === "invoice.paid" || evt.type === "invoice.payment_failed") {
    const i = evt.data.object as InvObj
    const invoiceId = idOf(i.id)
    const customerId = idOf(i.customer)
    const paid = evt.type === "invoice.paid"
    const amountMinor = paid ? i.amount_paid : i.amount_due
    const line = i.lines?.data?.[0]?.period
    const periodStart = date(line?.start ?? i.period_start)
    const periodEnd = date(line?.end ?? i.period_end)
    // Money is an integer in the currency's minor unit and the currency is whatever the provider says: never defaulted.
    if (!invoiceId || !customerId || typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || amountMinor < 0) return ignored
    if (typeof i.currency !== "string" || !/^[A-Za-z]{3}$/.test(i.currency) || !periodStart || !periodEnd) return ignored
    return { kind: evt.type, ...base, invoiceId, customerId, amountMinor, currency: i.currency.toUpperCase(), hostedUrl: https(i.hosted_invoice_url), periodStart, periodEnd }
  }
  return ignored
}

/** Stripe behind BillingProvider. Credentials come from `source` per call (platform settings win, env bootstrap, else 503). */
export class StripeBillingProvider implements BillingProvider {
  readonly id = "stripe" as const
  private clients = new Map<string, Stripe>()
  constructor(private source: StripeConfigSource) {}

  invalidate(): void {
    this.source.invalidate?.()
  }

  private async config(): Promise<StripeConfig> {
    const c = await this.source.get()
    if (!c) throw notConfigured()
    return c
  }
  private client(key: string): Stripe {
    let c = this.clients.get(key)
    if (!c) {
      c = new Stripe(key, { maxNetworkRetries: 2 })
      this.clients.set(key, c)
    }
    return c
  }
  private async stripe(): Promise<Stripe> {
    return this.client((await this.config()).secretKey)
  }

  async ensureCustomer(i: { tenantId: string; email: string; name: string }) {
    const c = await (await this.stripe()).customers.create({ email: i.email, name: i.name, metadata: { tenantId: i.tenantId } }, { idempotencyKey: `opsdesk-customer-${i.tenantId}` })
    return { customerId: c.id }
  }

  async createCheckout(i: { customerId: string; priceId: string; seats: number; successUrl: string; cancelUrl: string; trialDays?: number }) {
    const s = await (await this.stripe()).checkout.sessions.create({
      mode: "subscription",
      customer: i.customerId,
      line_items: [{ price: i.priceId, quantity: i.seats }],
      success_url: i.successUrl,
      cancel_url: i.cancelUrl,
      ...(i.trialDays && i.trialDays > 0 ? { subscription_data: { trial_period_days: i.trialDays } } : {}),
    })
    if (!s.url) throw new Error("checkout_no_url")
    return { url: s.url, sessionId: s.id }
  }

  async createPortal(i: { customerId: string; returnUrl: string }) {
    const s = await (await this.stripe()).billingPortal.sessions.create({ customer: i.customerId, return_url: i.returnUrl })
    return { url: s.url }
  }

  async cancelAtPeriodEnd(i: { subscriptionId: string }) {
    await (await this.stripe()).subscriptions.update(i.subscriptionId, { cancel_at_period_end: true })
  }

  async resume(i: { subscriptionId: string }) {
    await (await this.stripe()).subscriptions.update(i.subscriptionId, { cancel_at_period_end: false })
  }

  async updateSeats(i: { subscriptionId: string; seats: number }) {
    const stripe = await this.stripe()
    const sub = await stripe.subscriptions.retrieve(i.subscriptionId)
    const item = sub.items.data[0]
    if (!item) throw new Error("subscription_no_item")
    await stripe.subscriptions.update(i.subscriptionId, { items: [{ id: item.id, quantity: i.seats }], proration_behavior: "create_prorations" })
  }

  async retrieveSubscription(subscriptionId: string): Promise<SubscriptionSnapshot> {
    const snap = mapStripeSubscription(await (await this.stripe()).subscriptions.retrieve(subscriptionId))
    if (!snap) throw new Error("subscription_unreadable")
    return snap
  }

  async retrieveInvoice(invoiceId: string): Promise<InvoiceSnapshot> {
    const i = (await (await this.stripe()).invoices.retrieve(invoiceId)) as unknown as InvObj & { status?: unknown }
    const paid = i.status === "paid"
    const amountMinor = paid ? i.amount_paid : i.amount_due
    const customerId = idOf(i.customer)
    if (!customerId || typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor) || typeof i.currency !== "string") throw new Error("invoice_unreadable")
    return { invoiceId, customerId, paid, amountMinor, currency: i.currency.toUpperCase() }
  }

  async listActiveSubscriptions(customerId: string) {
    const l = await (await this.stripe()).subscriptions.list({ customer: customerId, status: "all", limit: 20 })
    return l.data.filter((s) => s.status !== "canceled" && s.status !== "incomplete_expired").map((s) => ({ id: s.id, status: s.status as string }))
  }

  async expireCheckoutSession(sessionId: string) {
    await (await this.stripe()).checkout.sessions.expire(sessionId)
  }

  async parseWebhook(rawBody: string, signature: string): Promise<BillingEvent> {
    const cfg = await this.config()
    let evt: Stripe.Event
    try {
      evt = this.client(cfg.secretKey).webhooks.constructEvent(rawBody, signature, cfg.webhookSecret)
    } catch {
      throw new InvalidSignatureError() // never surface the SDK message
    }
    return mapStripeEvent(evt as unknown as Parameters<typeof mapStripeEvent>[0])
  }
}
