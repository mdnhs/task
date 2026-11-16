import { and, eq } from "drizzle-orm"
import { Hono } from "hono"
import type { AppEnv } from "../../core/context"
import { problem } from "../../core/errors"
import { publish } from "../../core/events"
import { billingCustomers, billingEvents, invoices, memberships, platformBillingSettings, plans, roles, type InvoiceStatus } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { changeSubscriptionTx, invalidateEntitlements } from "../entitlements"
import { notify, withTenantAfterCommit, type Enqueue } from "../notifications"
import { InvalidSignatureError, type BillingEvent } from "./provider"

/** Audit actor for changes that came from the payment provider rather than a person. */
export const BILLING_ACTOR = "system:billing"

export type WebhookResult = "applied" | "duplicate" | "ignored"

/** Plan whose provider price is `priceId` (platform price map first, then plans.provider_price_ids), or null when unknown. */
async function planForPrice(tx: TenantTx, providerId: string, priceId: string): Promise<string | null> {
  const [s] = await tx.select({ priceMap: platformBillingSettings.priceMap }).from(platformBillingSettings).where(eq(platformBillingSettings.id, 1))
  const hit = Object.entries(s?.priceMap ?? {}).find(([, p]) => p === priceId)
  if (hit) return hit[0]
  const all = await tx.select({ id: plans.id, ids: plans.providerPriceIds }).from(plans)
  return all.find((p) => p.ids[providerId] === priceId)?.id ?? null
}

/** Money for a notification body: integer minor units shown in the currency's own fraction digits. */
export function formatMinor(amountMinor: number, currency: string): string {
  try {
    const f = new Intl.NumberFormat("en", { style: "currency", currency })
    const digits = f.resolvedOptions().maximumFractionDigits ?? 2
    return f.format(amountMinor / 10 ** digits)
  } catch {
    return `${amountMinor} ${currency}`
  }
}

type SubEvent = Extract<BillingEvent, { kind: "subscription.updated" }>
type InvEvent = Extract<BillingEvent, { kind: "invoice.paid" | "invoice.payment_failed" }>

async function applySubscription(tx: TenantTx, deps: Deps, tenantId: string, ev: SubEvent, now: Date): Promise<void> {
  const planId = await planForPrice(tx, deps.billing.id, ev.priceId)
  await changeSubscriptionTx(
    tx, tenantId, BILLING_ACTOR,
    (before) => {
      // Out-of-order guard: only an event newer than the last one applied may change the subscription (equal = same instant, already applied).
      if (before.updatedFromEventAt && ev.createdAt.getTime() <= before.updatedFromEventAt.getTime()) return null
      // A DEAD subscription that is not the current one (e.g. the old one's delete arriving after a re-subscribe) must not cancel the tenant.
      if (before.providerSubscriptionId && before.providerSubscriptionId !== ev.subscriptionId && ev.status === "canceled") return null
      // No SCA lockout mid-trial: an incomplete subscription keeps the tenant's running trial.
      const trialRunning = before.status === "trialing" && before.trialEndsAt !== null && before.trialEndsAt > now
      const keepTrial = ev.status === "incomplete" && trialRunning
      return {
        status: keepTrial ? "trialing" : ev.status,
        ...(planId ? { planId } : {}),
        seats: ev.seats,
        ...(keepTrial ? {} : { trialEndsAt: ev.trialEnd }),
        currentPeriodEnd: ev.currentPeriodEnd,
        cancelAtPeriodEnd: ev.cancelAtPeriodEnd,
        provider: deps.billing.id,
        providerCustomerId: ev.customerId,
        providerSubscriptionId: ev.subscriptionId,
        updatedFromEventAt: ev.createdAt,
      }
    },
    now,
  )
}

async function applyInvoice(tx: TenantTx, deps: Deps, tenantId: string, ev: InvEvent, now: Date, enqueue: Enqueue): Promise<void> {
  const status: InvoiceStatus = ev.kind === "invoice.paid" ? "paid" : "failed"
  const [existing] = await tx.select().from(invoices).where(eq(invoices.providerInvoiceId, ev.invoiceId)).for("update")
  if (existing && ev.createdAt.getTime() <= existing.eventAt.getTime()) return // an older or equal event never overwrites a newer one
  const values = { amountMinor: ev.amountMinor, currency: ev.currency, status, hostedUrl: ev.hostedUrl, periodStart: ev.periodStart, periodEnd: ev.periodEnd, eventAt: ev.createdAt }
  if (existing) await tx.update(invoices).set(values).where(eq(invoices.id, existing.id))
  else await tx.insert(invoices).values({ tenantId, providerInvoiceId: ev.invoiceId, createdAt: ev.createdAt, ...values })
  // Dunning: owners hear about an invoice exactly once, on its transition to failed (retries of the same invoice stay silent).
  if (status !== "failed" || existing?.status === "failed") return
  const owners = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, tenantId), eq(roles.key, "owner"), eq(memberships.status, "active")))
  for (const o of owners) {
    await notify(
      tx, tenantId,
      { userId: o.userId, kind: "billing", title: "Payment failed", body: `We could not collect ${formatMinor(ev.amountMinor, ev.currency)} for your subscription. Update your payment method to keep your workspace active.`, link: "/settings/billing" },
      deps, enqueue,
    )
  }
  await recordAudit(tx, tenantId, { action: "invoice.payment_failed", entity: "invoice", entityId: ev.invoiceId, actorId: BILLING_ACTOR, before: existing ? { status: existing.status } : null, after: { status, amountMinor: ev.amountMinor, currency: ev.currency } }, now)
  await publish(tx, { tenantId, type: "billing.payment_failed", payload: { invoiceId: ev.invoiceId, amountMinor: ev.amountMinor, currency: ev.currency }, actorId: BILLING_ACTOR }, now) // last (lock order)
}

/**
 * Applies a verified provider event exactly once. The billing_events row (PK provider + event id, ON CONFLICT DO NOTHING)
 * and every effect of the event share ONE tenant transaction: a duplicate delivery inserts nothing and applies nothing, a
 * failure rolls the ledger row back too (the provider retries), and a concurrent duplicate waits on the first's row.
 */
export async function processBillingEvent(deps: Deps, ev: BillingEvent): Promise<WebhookResult> {
  const provider = deps.billing.id
  const now = deps.clock.now()
  const record = (kind: string, tenantId: string | null) => ({ provider, providerEventId: ev.providerEventId, receivedAt: now, kind, targetTenantId: tenantId, processedAt: now })
  if (ev.kind === "ignored") {
    await deps.db.insert(billingEvents).values(record("ignored", null)).onConflictDoNothing()
    return "ignored"
  }
  const [map] = await deps.db.select({ tenantId: billingCustomers.targetTenantId }).from(billingCustomers).where(and(eq(billingCustomers.provider, provider), eq(billingCustomers.customerId, ev.customerId)))
  if (!map) {
    await deps.db.insert(billingEvents).values(record("ignored", null)).onConflictDoNothing() // unknown customer: recorded, acknowledged
    return "ignored"
  }
  const tenantId = map.tenantId
  const result = await withTenantAfterCommit(deps, tenantId, async (tx, enqueue): Promise<WebhookResult> => {
    const inserted = await tx.insert(billingEvents).values(record(ev.kind, tenantId)).onConflictDoNothing().returning({ id: billingEvents.providerEventId })
    if (inserted.length === 0) return "duplicate"
    if (ev.kind === "subscription.updated") await applySubscription(tx, deps, tenantId, ev, now)
    else await applyInvoice(tx, deps, tenantId, ev, now, enqueue)
    return "applied"
  })
  if (result === "applied") invalidateEntitlements(tenantId) // after commit: the next request sees the new plan/status at once
  return result
}

const log = (deps: Deps, code: string) => deps.logger.warn({ code }, "billing webhook rejected")

/**
 * POST /webhooks/billing/stripe: outside /v1, no session, authenticated only by the provider signature over the RAW body
 * (read as text before anything parses it). Plain Hono (not OpenAPI): it is not part of the tenant API surface.
 */
export const billingWebhookRoutes = new Hono<AppEnv>().post("/webhooks/billing/stripe", async (c) => {
  const deps = c.get("deps")
  const signature = c.req.header("stripe-signature")
  const raw = await c.req.text()
  if (!signature) return problem(400, "invalid_signature", "Bad Request", c.get("requestId"))
  let ev: BillingEvent
  try {
    ev = await deps.billing.parseWebhook(raw, signature)
  } catch (err) {
    if (err instanceof InvalidSignatureError) {
      log(deps, "invalid_signature")
      return problem(400, "invalid_signature", "Bad Request", c.get("requestId"))
    }
    throw err // AppError 503 billing_not_configured, or an unexpected failure (500)
  }
  await processBillingEvent(deps, ev)
  return c.json({ received: true }, 200)
})
