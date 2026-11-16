import { sql } from "drizzle-orm"
import { boolean, index, integer, jsonb, pgPolicy, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

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

// ---- Tenant-scoped tables. Standard RLS template (R8); FORCE is appended by hand in the migration. ----
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })
// app.user_id is set (transaction-local) by withUser() from the authenticated session. It lets a user read
// their OWN memberships (and the roles those point at) across tenants, for /v1/me and the idle-timeout lookup.
const userMatch = sql`user_id = nullif(current_setting('app.user_id', true), '')`

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    home: text("home").notNull(),
    access: jsonb("access").$type<Record<string, string>>().notNull(),
    fieldRules: jsonb("field_rules").$type<Record<string, string[]>>().notNull().default({}),
    isTemplate: boolean("is_template").notNull().default(false),
    clonedFrom: uuid("cloned_from"),
  },
  (t) => [
    unique("roles_tenant_key").on(t.tenantId, t.key),
    tenantPolicy(),
    pgPolicy("own_membership_role_read", {
      as: "permissive",
      for: "select",
      using: sql`exists (select 1 from memberships m where m.role_id = roles.id and m.user_id = nullif(current_setting('app.user_id', true), ''))`,
    }),
  ],
).enableRLS()

export const memberships = pgTable(
  "memberships",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    status: text("status").notNull().default("active"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
    tenantPolicy(),
    pgPolicy("own_memberships_read", { as: "permissive", for: "select", using: userMatch }),
  ],
).enableRLS()

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roleId: uuid("role_id").notNull().references(() => roles.id),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  },
  () => [tenantPolicy()],
).enableRLS()

export const tenantSettings = pgTable(
  "tenant_settings",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] }), tenantPolicy()],
).enableRLS()
