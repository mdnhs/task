import { sql } from "drizzle-orm"
import { bigint, foreignKey, integer, index, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { memberships, tenants } from "./tenants"

// Standard RLS template (R8); FORCE and the CHECK constraints are appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })

export const FILE_STATUSES = ["pending", "clean", "infected", "deleted"] as const
export type FileStatus = (typeof FILE_STATUSES)[number]

/**
 * File metadata; the bytes live in object storage under `key` = `t/<tenant_id>/<id>` (a CHECK constraint pins it, so a
 * key can never come from a client name). `etag` is the storage ETag the scan verdict applies to: a download re-checks
 * it, so an object replaced after the scan is never served on the old verdict. `uploaded_at` is set by the first
 * successful `complete`.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    // null = erased owner (GDPR) or system-generated; the FK is MATCH SIMPLE so null skips it.
    ownerUserId: text("owner_user_id"),
    // null = ordinary file; "dsr_export" = a generated GDPR export (download limited to its requester and settings:write).
    purpose: text("purpose"),
    key: text("key").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256"),
    status: text("status").notNull().default("pending"),
    signature: text("signature"),
    etag: text("etag"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    scannedAt: timestamp("scanned_at", { withTimezone: true }),
    // Set by the file.delete-object job once the object is really gone from storage; a `deleted` row without it is retried by the task retention job (T4.5).
    objectRemovedAt: timestamp("object_removed_at", { withTimezone: true }),
    // Retry bookkeeping of the task retention job for deleted files whose object is still there: attempts and the last attempt (exponential spacing, capped).
    objectRemovalAttempts: integer("object_removal_attempts").notNull().default(0),
    objectRemovalAttemptedAt: timestamp("object_removal_attempted_at", { withTimezone: true }),
  },
  (t) => [
    // No cascade: removing a membership must not silently drop metadata of objects that still exist in storage.
    foreignKey({ columns: [t.tenantId, t.ownerUserId], foreignColumns: [memberships.tenantId, memberships.userId], name: "files_owner_fk" }),
    unique("files_tenant_id_id").on(t.tenantId, t.id),
    unique("files_key").on(t.key),
    index("files_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("files_removal_pending_idx").on(t.tenantId, t.createdAt).where(sql`${t.status} = 'deleted' and ${t.objectRemovedAt} is null`),
    tenantPolicy(),
  ],
).enableRLS()
