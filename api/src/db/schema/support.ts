import { sql } from "drizzle-orm"
import { check, index, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { tenants } from "./tenants"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })

/**
 * Support access grants (T3.5, SRS §2.2): a platform staff member may READ one tenant for at most 24 hours. Tenant table with the
 * exact R8 policy + FORCE (the tenant lists its own grants; the platform side reads/writes it under withTenant(tenantId)).
 * Rows are never deleted: revocation sets revoked_at/revoked_by. app_user: SELECT, INSERT and UPDATE (revoked_at, revoked_by) only.
 */
export const supportGrants = pgTable(
  "support_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    staffUserId: text("staff_user_id").notNull(),
    reason: text("reason").notNull(),
    grantedBy: text("granted_by").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** `platform:<staffId>` or the revoking tenant member's user id. */
    revokedBy: text("revoked_by"),
  },
  (t) => [
    index("support_grants_tenant_staff_idx").on(t.tenantId, t.staffUserId, t.expiresAt),
    check("support_grants_window_check", sql`${t.expiresAt} > ${t.startsAt} AND ${t.expiresAt} <= ${t.startsAt} + interval '24 hours'`),
    check("support_grants_reason_check", sql`length(${t.reason}) BETWEEN 1 AND 500`),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * Platform-level, ids-only map grant id -> tenant (ruling C9 accepts ids-only platform tables). It lets
 * DELETE /v1/platform/support-grants/{id} find the tenant to open withTenant() on without widening RLS: it holds no reason,
 * staff or time data. Column is target_tenant_id (not tenant_id: not an RLS key, same as billing_customers).
 * app_user: SELECT + INSERT only (append-only).
 */
export const supportGrantIndex = pgTable("support_grant_index", {
  grantId: uuid("grant_id").primaryKey(),
  targetTenantId: uuid("target_tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
})
