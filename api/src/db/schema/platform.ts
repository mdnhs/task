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

// Platform-level singleton (no tenant_id, no RLS), same pattern as platform_email_settings: Cloudflare R2 for file
// storage, configured by the platform super admin. app_user gets SELECT/INSERT/UPDATE only (DELETE revoked in the migration).
export const platformStorageSettings = pgTable(
  "platform_storage_settings",
  {
    id: smallint("id").primaryKey().default(1),
    provider: text("provider").notNull().default("r2"),
    accountId: text("account_id").notNull(),
    bucket: text("bucket").notNull(),
    accessKeyId: text("access_key_id").notNull(),
    secretAccessKeyCiphertext: text("secret_access_key_ciphertext").notNull(),
    secretLast4: text("secret_last4").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  () => [check("platform_storage_settings_singleton", sql`id = 1`), check("platform_storage_settings_provider", sql`provider = 'r2'`)],
)
