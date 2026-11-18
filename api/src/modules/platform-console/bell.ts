import { and, eq, gt, isNull, lte } from "drizzle-orm"
import { dataRequests, platformStaff, subscriptions, supportGrants, tenants } from "../../db/schema"
import type { Db } from "../../deps"
import { eachTenant } from "./tenants"

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
/** A trial that ends within this many days is in the bell. */
export const BELL_TRIAL_DAYS = 7
/** At most this many items are returned (newest first); `unread` counts all of them. */
export const BELL_MAX_ITEMS = 100

export type BellKind = "data_request" | "failed_payment" | "trial_ending" | "grant_expiring"
/** Ids, names and dates only: never a subject, a requester, a reason or a member. */
export type BellItem = { kind: BellKind; tenantId: string; tenantName: string; refId: string | null; at: Date; until: Date | null }

/**
 * The platform bell (B8 Task 17): a feed DERIVED from what the platform already holds, no table of its own. Per tenant, under that tenant's own RLS context:
 *  - `data_request`  a GDPR request still `pending` (at = when it was opened, until = its due date, refId = its id);
 *  - `failed_payment` a subscription `past_due` or `unpaid` (at = the newest provider event applied, else the period end, else the tenant's creation);
 *  - `trial_ending`  a `trialing` subscription whose trial ends within 7 days from now (at = 7 days before the end, until = the end);
 *  - `grant_expiring` an ACTIVE support grant of THIS staff member (at = its start, until = its expiry: a grant lasts at most 24 hours, so every active one expires within 24 h; refId = its id).
 * Unread = items with `at` after the staff member's `notifications_seen_at` (all of them while it is null). Newest first, ties by kind, tenant name and ref id. O(tenants) round trips like the other
 * console reads (see `eachTenant`).
 */
export async function bellFeed(db: Db, now: Date, staffId: string): Promise<{ items: BellItem[]; unread: number }> {
  const [staff] = await db.select({ seen: platformStaff.notificationsSeenAt }).from(platformStaff).where(eq(platformStaff.userId, staffId))
  const ts = await db.select({ id: tenants.id, name: tenants.name, createdAt: tenants.createdAt }).from(tenants)
  const horizon = new Date(now.getTime() + BELL_TRIAL_DAYS * DAY_MS)
  const grantHorizon = new Date(now.getTime() + 24 * HOUR_MS)
  const rows = await eachTenant(db, ts.map((t) => t.id), async (tx, id) => ({
    sub: (await tx.select({ status: subscriptions.status, trialEndsAt: subscriptions.trialEndsAt, currentPeriodEnd: subscriptions.currentPeriodEnd, eventAt: subscriptions.updatedFromEventAt }).from(subscriptions).where(eq(subscriptions.tenantId, id)))[0],
    dsrs: await tx.select({ id: dataRequests.id, createdAt: dataRequests.createdAt, dueAt: dataRequests.dueAt }).from(dataRequests).where(and(eq(dataRequests.tenantId, id), eq(dataRequests.status, "pending"))),
    grants: await tx.select({ id: supportGrants.id, startsAt: supportGrants.startsAt, expiresAt: supportGrants.expiresAt }).from(supportGrants)
      .where(and(eq(supportGrants.tenantId, id), eq(supportGrants.staffUserId, staffId), isNull(supportGrants.revokedAt), lte(supportGrants.startsAt, now), gt(supportGrants.expiresAt, now), lte(supportGrants.expiresAt, grantHorizon))),
  }))
  const meta = new Map(ts.map((t) => [t.id, t]))
  const items: BellItem[] = []
  for (const { tenantId, value } of rows) {
    const t = meta.get(tenantId)!
    const base = { tenantId, tenantName: t.name }
    for (const d of value.dsrs) items.push({ ...base, kind: "data_request", refId: d.id, at: d.createdAt, until: d.dueAt })
    const s = value.sub
    if (s && (s.status === "past_due" || s.status === "unpaid")) items.push({ ...base, kind: "failed_payment", refId: null, at: s.eventAt ?? s.currentPeriodEnd ?? t.createdAt, until: null })
    if (s && s.status === "trialing" && s.trialEndsAt && s.trialEndsAt >= now && s.trialEndsAt <= horizon) items.push({ ...base, kind: "trial_ending", refId: null, at: new Date(s.trialEndsAt.getTime() - BELL_TRIAL_DAYS * DAY_MS), until: s.trialEndsAt })
    for (const g of value.grants) items.push({ ...base, kind: "grant_expiring", refId: g.id, at: g.startsAt, until: g.expiresAt })
  }
  items.sort((a, b) => b.at.getTime() - a.at.getTime() || a.kind.localeCompare(b.kind) || a.tenantName.localeCompare(b.tenantName) || (a.refId ?? "").localeCompare(b.refId ?? ""))
  const seen = staff?.seen ?? null
  return { items: items.slice(0, BELL_MAX_ITEMS), unread: items.filter((i) => seen === null || i.at.getTime() > seen.getTime()).length }
}

/** Stamps the staff member's `notifications_seen_at` with `now` (the clock, never the database's) and answers the stamp; a call never moves it backwards. */
export async function markBellSeen(db: Db, now: Date, staffId: string): Promise<{ seenAt: Date; unread: number }> {
  const [row] = await db.select({ seen: platformStaff.notificationsSeenAt }).from(platformStaff).where(eq(platformStaff.userId, staffId))
  const seenAt = row?.seen && row.seen.getTime() > now.getTime() ? row.seen : now
  await db.update(platformStaff).set({ notificationsSeenAt: seenAt }).where(eq(platformStaff.userId, staffId))
  return { seenAt, unread: 0 }
}
