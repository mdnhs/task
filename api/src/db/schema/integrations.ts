import { sql } from "drizzle-orm"
import { foreignKey, index, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { memberships, tenants } from "./tenants"

// Standard RLS template (R8); FORCE and the CHECK constraints are appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })

export const INTEGRATION_PROVIDERS = ["google"] as const
export const INTEGRATION_STATUSES = ["connected", "revoked", "error"] as const
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number]

/**
 * One connection per (tenant, provider). `token_ciphertext` is ONE secret-box v2 blob (access + refresh token, expiry,
 * scopes) sealed with AAD `integration:<tenant>:<provider>`; it is NULL exactly when the connection is `revoked`.
 * It is never selected into an API response, a log line or an audit entry.
 */
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    status: text("status").notNull(),
    scopes: text("scopes").array().notNull(),
    accountEmail: text("account_email"),
    tokenCiphertext: text("token_ciphertext"),
    connectedBy: text("connected_by").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
    lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
  },
  (t) => [
    // No cascade: removing a membership must not silently drop a live connection (and its notification target).
    foreignKey({ columns: [t.tenantId, t.connectedBy], foreignColumns: [memberships.tenantId, memberships.userId], name: "integration_connections_connected_by_fk" }),
    unique("integration_connections_tenant_provider").on(t.tenantId, t.provider),
    tenantPolicy(),
  ],
).enableRLS()

/** A started OAuth authorisation: only sha256(state) and the sealed PKCE verifier are stored. Single use, 10 minutes. */
export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    stateHash: text("state_hash").notNull(),
    verifierCiphertext: text("verifier_ciphertext").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "oauth_states_user_fk" }).onDelete("cascade"),
    unique("oauth_states_state_hash").on(t.stateHash),
    index("oauth_states_tenant_user_idx").on(t.tenantId, t.userId),
    tenantPolicy(),
  ],
).enableRLS()
