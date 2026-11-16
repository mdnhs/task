import { check, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// Platform-level (not per tenant): no tenant_id, so no RLS. Singleton row, managed by the platform super admin.
// app_user gets SELECT/INSERT/UPDATE only (DELETE is revoked in the migration).
export const platformEmailSettings = pgTable(
  "platform_email_settings",
  {
    id: smallint("id").primaryKey().default(1),
    provider: text("provider").notNull().default("resend"),
    apiKeyCiphertext: text("api_key_ciphertext").notNull(),
    apiKeyLast4: text("api_key_last4").notNull(),
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check("platform_email_settings_singleton", sql`id = 1`), check("platform_email_settings_provider", sql`provider = 'resend'`)],
)
