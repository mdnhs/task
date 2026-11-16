import { bigint, check, index, jsonb, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"
import { user } from "./auth"

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

// Platform staff (the operator's own people). No tenant_id, so no RLS: access is gated by requirePlatformStaff and the
// grants (app_user: SELECT/INSERT/UPDATE, never DELETE; a removed person is suspended, which keeps the history).
export const platformStaff = pgTable(
  "platform_staff",
  {
    userId: text("user_id").primaryKey().references(() => user.id),
    role: text("role").notNull(),
    status: text("status").notNull().default("active"),
    addedBy: text("added_by").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  () => [
    check("platform_staff_role_check", sql`role IN ('owner','support','billing','viewer')`),
    check("platform_staff_status_check", sql`status IN ('active','suspended')`),
  ],
)

// Append-only, hash-chained platform audit log (one global chain, ids never reused). No tenant_id, so no RLS; app_user
// has SELECT + INSERT only (the migration revokes UPDATE, DELETE and TRUNCATE). target_tenant_id is the tenant an action
// concerned, when any (not an RLS key).
export const platformAuditEvents = pgTable(
  "platform_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seq: bigint("seq", { mode: "number" }).notNull().unique(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    targetTenantId: uuid("target_tenant_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("platform_audit_events_entity_idx").on(t.entity, t.at)],
)
