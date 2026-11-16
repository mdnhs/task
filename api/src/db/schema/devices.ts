import { sql } from "drizzle-orm"
import { boolean, foreignKey, index, pgPolicy, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { memberships, tenants } from "./tenants"

// Standard RLS template (R8); FORCE and the CHECK constraints are appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })

/** The device register (FR-M0-08). A device is allocated to ONE member of the tenant and never moves to another. */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    type: text("type", { enum: ["pc", "android", "browser"] }).notNull(),
    owner: text("owner", { enum: ["company", "personal"] }).notNull(),
    label: text("label").notNull(),
    trusted: boolean("trusted").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "devices_member_fk" }).onDelete("cascade"),
    index("devices_user_idx").on(t.tenantId, t.userId),
    tenantPolicy(),
  ],
).enableRLS()

/** One row per tenant and feature; no row means the default ("any"). */
export const devicePolicies = pgTable(
  "device_policies",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    feature: text("feature", { enum: ["drive", "payroll"] }).notNull(),
    allow: text("allow", { enum: ["trusted-company-pc", "any", "none"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.feature] }), tenantPolicy()],
).enableRLS()
