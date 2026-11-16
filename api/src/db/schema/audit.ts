import { bigint, index, jsonb, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// Append-only, hash-chained audit log (FR-M0-13, NFR-05, AC-M0-04). app_user only has SELECT + INSERT
// (see the migration); the chain is per tenant, seq is gap-free, prev_hash is "GENESIS" for seq 1.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [
    unique("audit_events_tenant_seq").on(t.tenantId, t.seq),
    index("audit_events_entity_idx").on(t.tenantId, t.entity, t.at),
    pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch }),
  ],
).enableRLS()
