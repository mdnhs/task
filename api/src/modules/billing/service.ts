import { and, desc, eq, lt, or, sql } from "drizzle-orm"
import { AppError, Conflict } from "../../core/errors"
import { billingCustomers, invoices, plans, subscriptions } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { changeSubscription, entitlementsFor, seatsUsed, type BillingState, type SubscriptionStatus } from "../entitlements"
import { errorInfo } from "../../core/safe-error"
import { resolvePriceId } from "./settings"

const DAY_MS = 86_400_000
const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")

/** Runs a provider call; anything the provider throws (except our own AppErrors, e.g. 503) becomes 502 billing_provider_error. Logs a safe code only. */
async function viaProvider<T>(deps: Deps, op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AppError) throw err
    deps.logger.error({ op, ...errorInfo(err) }, "billing provider call failed") // never the message (provider errors can echo request data)
    throw new AppError(502, "billing_provider_error", "Bad Gateway")
  }
}

async function loadSub(deps: Deps, tenantId: string) {
  const [s] = await withTenant(deps.db, tenantId, (tx) => tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)))
  if (!s) throw new AppError(404, "subscription_not_found", "Not Found")
  return s
}

export type SubscriptionView = {
  planId: string; planName: string; priceMonthlyMinor: number; currency: string
  status: SubscriptionStatus; seats: number; seatsUsed: number; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean
  billingState: BillingState; graceEndsAt: Date | null; hasProviderSubscription: boolean; hasCustomer: boolean
}

export async function subscriptionView(deps: Deps, tenantId: string): Promise<SubscriptionView> {
  const ent = await entitlementsFor(deps, tenantId)
  return withTenant(deps.db, tenantId, async (tx) => {
    const [s] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId))
    if (!s) throw new AppError(404, "subscription_not_found", "Not Found")
    const [p] = await tx.select().from(plans).where(eq(plans.id, s.planId))
    return {
      planId: s.planId, planName: p.name, priceMonthlyMinor: p.priceMonthlyMinor, currency: p.currency,
      status: s.status, seats: ent.seats, seatsUsed: await seatsUsed(tx, tenantId), trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd, billingState: ent.billingState, graceEndsAt: ent.graceEndsAt,
      hasProviderSubscription: s.providerSubscriptionId !== null, hasCustomer: s.providerCustomerId !== null,
    }
  })
}

type Actor = { userId: string; email: string }

/** The tenant's provider customer, created (once; the provider call is idempotent per tenant) and linked on first use. */
async function ensureCustomer(deps: Deps, tenantId: string, tenantName: string, actor: Actor): Promise<string> {
  const sub = await loadSub(deps, tenantId)
  if (sub.providerCustomerId && sub.provider === deps.billing.id) return sub.providerCustomerId
  const { customerId } = await viaProvider(deps, "ensureCustomer", () => deps.billing.ensureCustomer({ tenantId, email: actor.email, name: tenantName }))
  await deps.db.insert(billingCustomers).values({ provider: deps.billing.id, customerId, targetTenantId: tenantId }).onConflictDoNothing()
  await changeSubscription(deps, tenantId, actor.userId, { provider: deps.billing.id, providerCustomerId: customerId })
  return customerId
}

async function assertSeats(deps: Deps, tenantId: string, seats: number): Promise<void> {
  const used = await withTenant(deps.db, tenantId, (tx) => seatsUsed(tx, tenantId))
  if (seats < used) throw unprocessable("seats_below_members")
}

const LIVE = new Set(["trialing", "active", "past_due", "unpaid", "paused", "incomplete"])

export async function startCheckout(deps: Deps, tenant: { id: string; name: string }, actor: Actor, input: { planId: string; seats: number }): Promise<{ url: string }> {
  const [plan] = await deps.db.select().from(plans).where(eq(plans.id, input.planId))
  if (!plan || !plan.active) throw unprocessable("unknown_plan")
  const priceId = await resolvePriceId(deps.db, deps.billing.id, plan)
  if (!priceId) throw unprocessable("plan_not_purchasable")
  await assertSeats(deps, tenant.id, input.seats)
  const sub = await loadSub(deps, tenant.id)
  // One subscription per tenant: a tenant that already pays changes plan or card in the portal, never by a second checkout.
  if (sub.providerSubscriptionId && LIVE.has(sub.status) && sub.status !== "incomplete") throw Conflict("already_subscribed")
  const customerId = await ensureCustomer(deps, tenant.id, tenant.name, actor)
  const now = deps.clock.now()
  // A trial that is still running carries over into the paid subscription (no double trial, no early charge).
  const trialDays = sub.status === "trialing" && sub.trialEndsAt && sub.trialEndsAt > now ? Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / DAY_MS) : undefined
  const base = `${deps.env.APP_URL}/settings/billing`
  const { url } = await viaProvider(deps, "createCheckout", () =>
    deps.billing.createCheckout({ customerId, priceId, seats: input.seats, successUrl: `${base}?status=success`, cancelUrl: `${base}?status=cancelled`, trialDays }),
  )
  return { url }
}

export async function openPortal(deps: Deps, tenantId: string): Promise<{ url: string }> {
  const sub = await loadSub(deps, tenantId)
  if (!sub.providerCustomerId || sub.provider !== deps.billing.id) throw Conflict("no_customer")
  const customerId = sub.providerCustomerId
  return viaProvider(deps, "createPortal", () => deps.billing.createPortal({ customerId, returnUrl: `${deps.env.APP_URL}/settings/billing?status=portal` }))
}

async function needSubscription(deps: Deps, tenantId: string): Promise<{ subscriptionId: string; cancelAtPeriodEnd: boolean }> {
  const sub = await loadSub(deps, tenantId)
  if (!sub.providerSubscriptionId || sub.provider !== deps.billing.id) throw Conflict("no_subscription")
  return { subscriptionId: sub.providerSubscriptionId, cancelAtPeriodEnd: sub.cancelAtPeriodEnd }
}

/** NFR-18: self-service cancellation. Takes effect at the period end; the webhook confirms. Audited via changeSubscription. */
export async function cancelSubscription(deps: Deps, tenantId: string, actorId: string): Promise<void> {
  const { subscriptionId, cancelAtPeriodEnd } = await needSubscription(deps, tenantId)
  if (cancelAtPeriodEnd) return // already set: idempotent
  await viaProvider(deps, "cancelAtPeriodEnd", () => deps.billing.cancelAtPeriodEnd({ subscriptionId }))
  await changeSubscription(deps, tenantId, actorId, { cancelAtPeriodEnd: true })
}

export async function resumeSubscription(deps: Deps, tenantId: string, actorId: string): Promise<void> {
  const { subscriptionId, cancelAtPeriodEnd } = await needSubscription(deps, tenantId)
  if (!cancelAtPeriodEnd) return
  await viaProvider(deps, "resume", () => deps.billing.resume({ subscriptionId }))
  await changeSubscription(deps, tenantId, actorId, { cancelAtPeriodEnd: false })
}

export async function updateSeats(deps: Deps, tenantId: string, actorId: string, seats: number): Promise<void> {
  const { subscriptionId } = await needSubscription(deps, tenantId)
  await assertSeats(deps, tenantId, seats)
  await viaProvider(deps, "updateSeats", () => deps.billing.updateSeats({ subscriptionId, seats }))
  await changeSubscription(deps, tenantId, actorId, { seats })
}

export type InvoiceRow = typeof invoices.$inferSelect
const encode = (r: InvoiceRow) => Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString("base64url")
function decode(cursor: string): { at: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|")
  const at = new Date(iso ?? "")
  if (!id || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) throw new AppError(400, "invalid_cursor", "Bad Request")
  return { at, id }
}

/** Newest first, keyset-paginated on (created_at, id). */
export async function listInvoices(deps: Deps, tenantId: string, o: { limit: number; cursor?: string }): Promise<{ items: InvoiceRow[]; nextCursor: string | null }> {
  const after = o.cursor ? decode(o.cursor) : null
  const rows = await withTenant(deps.db, tenantId, (tx) =>
    tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), after ? or(lt(invoices.createdAt, after.at), and(eq(invoices.createdAt, after.at), sql`${invoices.id} < ${after.id}::uuid`)) : undefined))
      .orderBy(desc(invoices.createdAt), desc(invoices.id))
      .limit(o.limit + 1),
  )
  const items = rows.slice(0, o.limit)
  return { items, nextCursor: rows.length > o.limit ? encode(items[items.length - 1]) : null }
}
