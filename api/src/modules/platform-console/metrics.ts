import { and, eq, sql } from "drizzle-orm"
import { auditEvents, plans, subscriptions, tenants } from "../../db/schema"
import type { Db } from "../../deps"
import { eachTenant } from "./tenants"

const DAY_MS = 86_400_000
export const CHURN_WINDOW_DAYS = 30

export type PlatformMetrics = {
  /** Monthly recurring revenue per ISO currency, integer minor units. */
  mrrMinor: Record<string, number>
  arrMinor: Record<string, number>
  trials: number
  pastDue: number
  churnLast30Days: number
}

/**
 * Monthly equivalent of one subscription in minor units. The plan price is stored per seat per month (Stripe bills
 * `price x quantity`, quantity = seats), so it is price x seats. Plans carry no billing interval today: if a yearly
 * price is ever stored, it contributes Math.round(price / 12) here (integer math only, never floats).
 */
export function monthlyEquivalentMinor(priceMinor: number, seats: number, interval: "month" | "year" = "month"): number {
  const unit = interval === "year" ? Math.round(priceMinor / 12) : priceMinor
  return unit * seats
}

/**
 * MRR/ARR from active + past_due subscriptions, trials and past_due counts, and churn. Churn = subscriptions that moved to
 * canceled in the last 30 days, read from the tenant audit chain (`subscription.changed` with before.status != canceled and
 * after.status = canceled): the subscriptions table has no canceled_at, and the audit row is the exact transition time.
 * O(tenants) under per-tenant RLS (see eachTenant).
 */
export async function platformMetrics(db: Db, now: Date): Promise<PlatformMetrics> {
  const ids = (await db.select({ id: tenants.id }).from(tenants)).map((t) => t.id)
  const since = new Date(now.getTime() - CHURN_WINDOW_DAYS * DAY_MS)
  const rows = await eachTenant(db, ids, async (tx, id) => {
    const [s] = await tx
      .select({ status: subscriptions.status, seats: subscriptions.seats, price: plans.priceMonthlyMinor, currency: plans.currency })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .where(eq(subscriptions.tenantId, id))
    const [churn] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, id), eq(auditEvents.action, "subscription.changed"), sql`${auditEvents.after}->>'status' = 'canceled'`, sql`${auditEvents.before}->>'status' is distinct from 'canceled'`, sql`${auditEvents.at} >= ${since}`, sql`${auditEvents.at} <= ${now}`))
    return { s, churned: churn.n > 0 }
  })
  const m: PlatformMetrics = { mrrMinor: {}, arrMinor: {}, trials: 0, pastDue: 0, churnLast30Days: 0 }
  for (const { value: { s, churned } } of rows) {
    if (churned) m.churnLast30Days++
    if (!s) continue
    if (s.status === "trialing") m.trials++
    if (s.status === "past_due") m.pastDue++
    if (s.status === "active" || s.status === "past_due") {
      const cur = s.currency.toUpperCase()
      m.mrrMinor[cur] = (m.mrrMinor[cur] ?? 0) + monthlyEquivalentMinor(s.price, s.seats)
    }
  }
  for (const [cur, v] of Object.entries(m.mrrMinor)) m.arrMinor[cur] = v * 12
  return m
}
