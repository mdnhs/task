import { index, jsonb, pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { tenants } from "./tenants"

// Transactional outbox for domain events (T2.1). `publish` writes a row in the caller's tenant tx, so a rollback
// removes the event too; the relay delivers it to subscribers afterwards.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`

export const domainEvents = pgTable(
  "domain_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    actorId: text("actor_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    relayedAt: timestamp("relayed_at", { withTimezone: true }),
  },
  (t) => [
    index("domain_events_pending_idx").on(t.tenantId, t.occurredAt).where(sql`relayed_at is null`),
    pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch }),
  ],
).enableRLS()

// One row per (event, subscriber) that already ran. Inserted in the same tx as the subscriber's DB effects.
export const eventDeliveries = pgTable(
  "event_deliveries",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().references(() => domainEvents.id, { onDelete: "cascade" }),
    subscriber: text("subscriber").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.subscriber] }),
    pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch }),
  ],
).enableRLS()

// SINGLE documented RLS exception (ruling B1): tenant ids only, no business data, so the relay can discover which
// tenants have pending events without a tenant context. The column is `tenant` (not `tenant_id`) on purpose; the
// structural RLS guard keys on `tenant_id`.
export const eventRelayHints = pgTable("event_relay_hints", { tenant: uuid("tenant").primaryKey() })
