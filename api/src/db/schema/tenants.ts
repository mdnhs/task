import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

// No tenant_id column, so no RLS: looked up by slug before a tenant context exists.
// Defaults mirror public/data/auth/onboarding-defaults.json (FR-M0-20); services seed from that data.
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Europe/Dublin"),
  currency: text("currency").notNull().default("EUR"),
  locale: text("locale").notNull().default("en-IE"),
  sessionIdleHours: integer("session_idle_hours").notNull().default(12),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})
