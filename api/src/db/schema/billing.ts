import { sql } from "drizzle-orm"
import { boolean, check, integer, jsonb, pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })

/**
 * Plan catalogue (platform-level, NO tenant_id so no RLS). Seeded by migration from public/data/billing/plans.json with
 * money in minor units (integer cents). app_user may only SELECT (writes go through migrations / platform routes later).
 */
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priceMonthlyMinor: integer("price_monthly_minor").notNull(),
  currency: text("currency").notNull(),
  trialDays: integer("trial_days").notNull(),
  limits: jsonb("limits").$type<Record<string, number>>().notNull(),
  providerPriceIds: jsonb("provider_price_ids").$type<Record<string, string>>().notNull().default({}),
  active: boolean("active").notNull().default(true),
})

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled", "incomplete"] as const
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number]

/** One subscription per tenant. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
    planId: text("plan_id").notNull().references(() => plans.id),
    status: text("status").$type<SubscriptionStatus>().notNull(),
    seats: integer("seats").notNull(),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    provider: text("provider"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    /** `created` of the newest provider event applied (out-of-order guard, T3.3). */
    updatedFromEventAt: timestamp("updated_from_event_at", { withTimezone: true }),
  },
  () => [tenantPolicy()],
).enableRLS()

/** Per-tenant add-on grant or revoke on top of the plan. Core modules cannot be revoked (enforced in the service and in effectiveModules). */
export const moduleOverrides = pgTable(
  "module_overrides",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    mode: text("mode", { enum: ["grant", "revoke"] }).notNull(),
    reason: text("reason").notNull(),
    setBy: text("set_by").notNull(),
    setAt: timestamp("set_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.module] }), check("module_overrides_mode_check", sql`${t.mode} IN ('grant','revoke')`), tenantPolicy()],
).enableRLS()
