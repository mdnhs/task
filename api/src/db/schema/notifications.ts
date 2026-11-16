import { sql } from "drizzle-orm"
import { boolean, foreignKey, index, integer, jsonb, pgPolicy, pgTable, primaryKey, text, time, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { memberships, tenants } from "./tenants"

// Standard RLS template (R8); FORCE and the CHECK constraints are appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })

export type ChannelPrefs = { inApp?: boolean; email?: boolean; push?: boolean }

/** One row per notification. `in_app = false` rows exist only to carry content for email/push (hidden from the inbox). */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    inApp: boolean("in_app").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "notifications_member_fk" }).onDelete("cascade"),
    unique("notifications_tenant_id_id").on(t.tenantId, t.id),
    index("notifications_user_idx").on(t.tenantId, t.userId, t.createdAt),
    tenantPolicy(),
  ],
).enableRLS()

/** `channels` holds per-kind overrides of the defaults ({ [kind]: { inApp?, email?, push? } }). */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    channels: jsonb("channels").$type<Record<string, ChannelPrefs>>().notNull().default({}),
    quietStart: time("quiet_start"),
    quietEnd: time("quiet_end"),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "notification_preferences_member_fk" }).onDelete("cascade"),
    tenantPolicy(),
  ],
).enableRLS()

/** FCM/Android push tokens. Sealed (secret-box v2, AAD push_token:<tenant>:<user>); token_hash (sha256 hex) dedupes. */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    platform: text("platform", { enum: ["android"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "push_tokens_member_fk" }).onDelete("cascade"),
    unique("push_tokens_user_hash").on(t.tenantId, t.userId, t.tokenHash),
    tenantPolicy(),
  ],
).enableRLS()

/** One row per (notification, external channel). status: queued | held (quiet hours) | sent | failed | skipped. */
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    notificationId: uuid("notification_id").notNull(),
    channel: text("channel", { enum: ["email", "push"] }).notNull(),
    status: text("status", { enum: ["queued", "held", "sent", "failed", "skipped"] }).notNull(),
    sendAfter: timestamp("send_after", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.notificationId], foreignColumns: [notifications.tenantId, notifications.id], name: "notification_deliveries_notification_fk" }).onDelete("cascade"),
    unique("notification_deliveries_notification_channel").on(t.notificationId, t.channel),
    tenantPolicy(),
  ],
).enableRLS()
