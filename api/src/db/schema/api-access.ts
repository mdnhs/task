import { sql } from "drizzle-orm"
import { boolean, index, integer, jsonb, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })
const ts = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Per-tenant API keys (T3.6, FR-M0-17). Only the sha256 (hex) of the full `odk_<prefix>_<secret>` key is stored; the key is
 * shown once in the POST response. Rows are never deleted: revocation sets revoked_at. app_user: SELECT, INSERT and
 * UPDATE (last_used_at, revoked_at) only, so a stolen app_user connection cannot rewrite a hash or widen the scopes.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
    lastUsedAt: ts("last_used_at"),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("api_keys_prefix_uidx").on(t.prefix), index("api_keys_tenant_idx").on(t.tenantId, t.createdAt), tenantPolicy()],
).enableRLS()

/**
 * Platform-level, ids-only map prefix -> (tenant, key), ruling C9 (same pattern as support_grant_index). It lets
 * requireTenant find the tenant of a presented key BEFORE any tenant context exists, without widening RLS: it holds no hash,
 * secret, name or scope. Column is target_tenant_id (not tenant_id: not an RLS key, same as support_grant_index). No RLS. app_user: SELECT + INSERT only (append-only). Cascades with the tenant.
 */
export const apiKeyIndex = pgTable("api_key_index", {
  prefix: text("prefix").primaryKey(),
  targetTenantId: uuid("target_tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  keyId: uuid("key_id").notNull(),
})

/**
 * Outgoing webhook endpoints (T3.6). The signing secret is sealed (secret-box v2, AAD `webhook:<tenantId>:<endpointId>`),
 * shown once on create and never returned again. Rows are soft-deleted (deleted_at; the ciphertext is blanked), never removed.
 * `failing_since` is the start of the current unbroken run of failed deliveries (auto-disable after 3 days).
 */
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secretCiphertext: text("secret_ciphertext").notNull(),
    events: text("events").array().notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
    failingSince: ts("failing_since"),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("webhook_endpoints_tenant_idx").on(t.tenantId, t.createdAt), tenantPolicy()],
).enableRLS()

/**
 * One delivery of one event to one endpoint. UNIQUE (endpoint_id, event_id) makes the fan-out idempotent. `payload` is the
 * ids-only envelope that is signed and sent (identical on every retry). Only the response STATUS is kept, never a body.
 */
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    endpointId: uuid("endpoint_id").notNull().references(() => webhookEndpoints.id),
    eventId: uuid("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"pending" | "delivered" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull(),
    lastStatusCode: integer("last_status_code"),
    lastError: text("last_error"),
    createdAt: ts("created_at").notNull().defaultNow(),
    deliveredAt: ts("delivered_at"),
  },
  (t) => [
    uniqueIndex("webhook_deliveries_endpoint_event_uidx").on(t.endpointId, t.eventId),
    index("webhook_deliveries_due_idx").on(t.tenantId, t.status, t.nextAttemptAt),
    tenantPolicy(),
  ],
).enableRLS()
