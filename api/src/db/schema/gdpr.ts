import { sql } from "drizzle-orm"
import { foreignKey, index, pgPolicy, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import { files } from "./files"
import { tenants } from "./tenants"

// Standard RLS template (R8); FORCE and the CHECK constraints are appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })

export const DSR_KINDS = ["export", "correct", "erase"] as const
export const DSR_STATUSES = ["pending", "running", "completed", "rejected", "failed"] as const
export type DsrKind = (typeof DSR_KINDS)[number]
export type DsrStatus = (typeof DSR_STATUSES)[number]

/**
 * GDPR data-subject requests (FR-M0-19). `subject_user_id` / `requested_by` are plain ids WITHOUT a membership FK on
 * purpose: erasing the subject removes their membership, but the request (the accountability record) must stay.
 * `reason` / `notes` are free text typed by people: they are stored here only (never logged, never copied into the
 * audit chain) and are scrubbed to a marker when the subject is erased. `error_code` is a short code, never a message.
 */
export const dataRequests = pgTable(
  "data_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    subjectUserId: text("subject_user_id").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    resultFileId: uuid("result_file_id"),
    errorCode: text("error_code"),
    notes: text("notes"),
  },
  (t) => [
    unique("data_requests_tenant_id_id").on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.resultFileId], foreignColumns: [files.tenantId, files.id], name: "data_requests_result_file_fk" }),
    index("data_requests_tenant_due_idx").on(t.tenantId, t.dueAt),
    index("data_requests_subject_idx").on(t.tenantId, t.subjectUserId),
    tenantPolicy(),
  ],
).enableRLS()
