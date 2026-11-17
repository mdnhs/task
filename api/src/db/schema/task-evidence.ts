import { sql } from "drizzle-orm"
import { check, foreignKey, index, integer, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { tasks } from "./tasks"
import { files } from "./files"
import { tenants } from "./tenants"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })
const ts = (name: string) => timestamp(name, { withTimezone: true })

export const EVIDENCE_KINDS = ["photo", "image", "pdf", "office", "video", "checklist", "signature", "note", "drive"] as const
export const EVIDENCE_REVIEWS = ["pending", "accepted", "rejected"] as const

/**
 * Proof that work was done (FR-M1-40..48). One row per item; a file item points at a `files` row (scanned before anyone relies on it, ruling D10)
 * that is ALSO registered in `task_files`, so the purge finds it. Items leave with their task through the composite ON DELETE CASCADE (the purge
 * runs as the table owner). `round` is the submission round (a reject starts the next one); rejected items stay as earlier versions.
 * created_by is the member the item belongs to (the creator for an API key), nulled on erasure; reviewed_by is a member, `system:scanner` or
 * `system:auto`. `device_id` is the server-side device of the request (no foreign key: a removed device must not block anything). Location is never stored (Q6).
 */
export const taskEvidence = pgTable(
  "task_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    round: integer("round").notNull().default(1),
    kind: text("kind").notNull(),
    fileId: uuid("file_id"),
    text: text("text"),
    url: text("url"),
    source: text("source"),
    capturedAt: ts("captured_at"),
    deviceId: uuid("device_id"),
    review: text("review").notNull().default("pending"),
    reason: text("reason"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull(),
    lockedAt: ts("locked_at"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: "task_evidence_task_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.fileId], foreignColumns: [files.tenantId, files.id], name: "task_evidence_file_fk" }),
    check("task_evidence_kind_check", sql`${t.kind} IN ('photo','image','pdf','office','video','checklist','signature','note','drive')`),
    check("task_evidence_review_check", sql`${t.review} IN ('pending','accepted','rejected')`),
    check("task_evidence_source_check", sql`${t.source} IS NULL OR ${t.source} IN ('camera','upload')`),
    check("task_evidence_round_check", sql`${t.round} >= 1`),
    // a file kind has a file; a note (and the checklist snapshot "Checklist n/m") has text; a drive item has a link
    check("task_evidence_file_check", sql`(${t.kind} IN ('photo','image','pdf','office','video','signature')) = (${t.fileId} IS NOT NULL)`),
    check("task_evidence_text_check", sql`(${t.kind} IN ('note','checklist')) = (${t.text} IS NOT NULL)`),
    check("task_evidence_url_check", sql`(${t.kind} = 'drive') = (${t.url} IS NOT NULL)`),
    check("task_evidence_len_check", sql`char_length(${t.text}) <= 2000 AND char_length(${t.url}) <= 2000`),
    uniqueIndex("task_evidence_file_uidx").on(t.tenantId, t.fileId).where(sql`${t.fileId} is not null`),
    index("task_evidence_task_idx").on(t.tenantId, t.taskId, t.round),
    index("task_evidence_gallery_idx").on(t.tenantId, t.review, t.createdAt, t.id),
    tenantPolicy(),
  ],
).enableRLS()
