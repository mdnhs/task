import { sql } from "drizzle-orm"
import { check, date, foreignKey, index, integer, jsonb, pgPolicy, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { files } from "./files"
import { shiftPatterns } from "./shifts"
import { teams } from "./teams"
import { tasks } from "./tasks"
import { memberships, tenants } from "./tenants"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })
const ts = (name: string) => timestamp(name, { withTimezone: true })

/**
 * An end-of-shift report (M1, FR-M1-22..31). One per (member, pattern, shift start date): the row is created by `POST /v1/shift-reports/open`
 * (F4: a shift nobody touched costs no row). `start_at`, `end_at`, `due_at` are UTC instants computed once from the pattern when the row is first saved
 * and never re-derived (F3). `user_id` is NULLED (never cascaded) when the membership goes (erasure, F22): the report stays as a record without a person.
 * `version` is the optimistic-lock counter (every draft save and every submit bumps it); `submissions` counts the submitted versions.
 * The `user_id` foreign key is hand-written in the migration as `ON DELETE SET NULL ("user_id")` (drizzle cannot express a column list).
 */
export const shiftReports = pgTable(
  "shift_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    patternId: uuid("pattern_id").notNull(),
    shiftDate: date("shift_date", { mode: "string" }).notNull(),
    teamId: uuid("team_id").notNull(),
    shiftName: text("shift_name").notNull(),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    dueAt: ts("due_at").notNull(),
    status: text("status").notNull().default("draft"),
    summary: text("summary").notNull().default(""),
    blockers: text("blockers").notNull().default(""),
    unplanned: jsonb("unplanned").$type<{ id: string; text: string; minutes: number }[]>().notNull().default(sql`'[]'::jsonb`),
    extra: jsonb("extra").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    firstSubmittedAt: ts("first_submitted_at"),
    submittedAt: ts("submitted_at"),
    reviewedAt: ts("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    version: integer("version").notNull().default(1),
    submissions: integer("submissions").notNull().default(0),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    unique("shift_reports_tenant_id_id").on(t.tenantId, t.id),
    unique("shift_reports_key").on(t.tenantId, t.userId, t.patternId, t.shiftDate),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "shift_reports_member_fk" }),
    foreignKey({ columns: [t.tenantId, t.patternId], foreignColumns: [shiftPatterns.tenantId, shiftPatterns.id], name: "shift_reports_pattern_fk" }),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id], name: "shift_reports_team_fk" }),
    check("shift_reports_status_check", sql`${t.status} IN ('draft','submitted','accepted','returned')`),
    check("shift_reports_summary_check", sql`char_length(${t.summary}) <= 4000`),
    check("shift_reports_blockers_check", sql`char_length(${t.blockers}) <= 2000`),
    check("shift_reports_version_check", sql`${t.version} >= 1 AND ${t.submissions} >= 0`),
    index("shift_reports_inbox_idx").on(t.tenantId, t.shiftDate.desc(), t.id),
    index("shift_reports_user_idx").on(t.tenantId, t.userId, t.shiftDate.desc()),
    index("shift_reports_open_idx").on(t.tenantId, t.dueAt).where(sql`${t.status} in ('draft','returned')`),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * One row per task the member reports on. `task_id` is nulled when the task is purged (the row, its title and ref are kept: the report was made about it);
 * `task_ref` is the task's ref number and `title`, `due_at` a snapshot taken when the row was first saved (F9).
 */
export const shiftReportItems = pgTable(
  "shift_report_items",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull(),
    position: smallint("position").notNull(),
    taskId: uuid("task_id"),
    taskRef: integer("task_ref").notNull(),
    title: text("title").notNull(),
    dueAt: ts("due_at").notNull(),
    status: text("status").notNull(),
    minutes: integer("minutes").notNull().default(0),
    note: text("note").notNull().default(""),
  },
  (t) => [
    primaryKey({ columns: [t.reportId, t.position] }),
    foreignKey({ columns: [t.tenantId, t.reportId], foreignColumns: [shiftReports.tenantId, shiftReports.id], name: "shift_report_items_report_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: "shift_report_items_task_fk" }),
    check("shift_report_items_status_check", sql`${t.status} IN ('done','in_progress','blocked','not_started')`),
    check("shift_report_items_minutes_check", sql`${t.minutes} BETWEEN 0 AND 1440`),
    check("shift_report_items_note_check", sql`char_length(${t.note}) <= 1000`),
    index("shift_report_items_task_idx").on(t.tenantId, t.taskId).where(sql`${t.taskId} is not null`),
    uniqueIndex("shift_report_items_task_uq").on(t.reportId, t.taskId).where(sql`${t.taskId} is not null`),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * A frozen submission: one row per submit (`v` = the submission number), immutable (the app may only read and append; the one exception is the subject's
 * erasure, which may rewrite `snapshot` and null `by_user`, F22). `request_id` is the client's idempotency key (F7): a replay finds its row.
 */
export const shiftReportVersions = pgTable(
  "shift_report_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull(),
    v: integer("v").notNull(),
    at: ts("at").notNull(),
    byUser: text("by_user"),
    requestId: uuid("request_id").notNull(),
    note: text("note").notNull(),
    snapshot: jsonb("snapshot").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.reportId], foreignColumns: [shiftReports.tenantId, shiftReports.id], name: "shift_report_versions_report_fk" }).onDelete("cascade"),
    unique("shift_report_versions_v").on(t.reportId, t.v),
    unique("shift_report_versions_request").on(t.reportId, t.requestId),
    check("shift_report_versions_v_check", sql`${t.v} >= 1`),
    tenantPolicy(),
  ],
).enableRLS()

/** A reviewer's comment (F6; written by T5.3). Append-only; `by_user` is nulled for an erased author. */
export const shiftReportComments = pgTable(
  "shift_report_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull(),
    at: ts("at").notNull(),
    byUser: text("by_user"),
    kind: text("kind").notNull(),
    text: text("text").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.reportId], foreignColumns: [shiftReports.tenantId, shiftReports.id], name: "shift_report_comments_report_fk" }).onDelete("cascade"),
    check("shift_report_comments_kind_check", sql`${t.kind} IN ('return','accept')`),
    check("shift_report_comments_text_check", sql`char_length(${t.text}) <= 2000`),
    index("shift_report_comments_report_idx").on(t.tenantId, t.reportId, t.at),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * A report attachment (purpose `report_attachment`): reachable ONLY through the report routes, never through /v1/files, search or webhooks (F16).
 * Written by the upload intent in the same tx as the `files` row. `user_id` is the uploader, nulled on erasure.
 */
export const shiftReportFiles = pgTable(
  "shift_report_files",
  {
    fileId: uuid("file_id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    reportId: uuid("report_id").notNull(),
    userId: text("user_id"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.reportId], foreignColumns: [shiftReports.tenantId, shiftReports.id], name: "shift_report_files_report_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.fileId], foreignColumns: [files.tenantId, files.id], name: "shift_report_files_file_fk" }),
    index("shift_report_files_report_idx").on(t.tenantId, t.reportId),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * The deadline job's ledger (F12, T5.4): one row per (member, shift start date, kind) that was ALERTED, `kind` = `prompt` (the shift has ended, the report is due) or `missing` (the due time passed
 * with nothing submitted). The unique key is the exactly-once guard: the job inserts `ON CONFLICT DO NOTHING RETURNING` and writes the notifications in the SAME transaction only when a row came back, so two
 * workers, a retry, a restart or the repeated October hour can neither double-send nor lose an alert. No foreign key to `shift_reports` (a missing alert has no report row, F4). `user_id` has a composite
 * member FK with ON DELETE CASCADE (hand-written in the migration, run as the table owner), so an erased member's ledger rows leave with the membership (F22) although the app role can only SELECT and INSERT.
 */
export const shiftReportAlerts = pgTable(
  "shift_report_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    patternId: uuid("pattern_id").notNull(),
    shiftDate: date("shift_date", { mode: "string" }).notNull(),
    kind: text("kind").notNull(),
    alertedAt: ts("alerted_at").notNull(),
  },
  (t) => [
    unique("shift_report_alerts_key").on(t.tenantId, t.userId, t.patternId, t.shiftDate, t.kind),
    foreignKey({ columns: [t.tenantId, t.patternId], foreignColumns: [shiftPatterns.tenantId, shiftPatterns.id], name: "shift_report_alerts_pattern_fk" }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "shift_report_alerts_member_fk" }).onDelete("cascade"),
    check("shift_report_alerts_kind_check", sql`${t.kind} IN ('prompt','missing')`),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * A shift-report export (PDF, Excel or CSV, T5.5, FR-M1-31): a request row the `report.export` job works through and a pointer to the generated file in Files (purpose `report_export`).
 * Only the requester reads or downloads it. `filters` is what was asked (range, team, person, status, or the single `reportId`) plus the report `scope` the requester had when asking: the job re-resolves the
 * scope when it runs and refuses (`forbidden`) when it is now narrower. `claimed_until` is the worker lease (a crashed worker's `running` row is re-claimed after it, by the sweep). `expires_at` is set when the
 * file is written (completion + 7 days). `row_count` is the number of reports in the file. The file's name and the audit rows never carry a person's name.
 */
export const reportExports = pgTable(
  "report_exports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").notNull(),
    format: text("format").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull(),
    reportId: uuid("report_id"),
    status: text("status").notNull().default("queued"),
    fileId: uuid("file_id"),
    rowCount: integer("row_count"),
    errorCode: text("error_code"),
    claimedUntil: ts("claimed_until"),
    createdAt: ts("created_at").notNull(),
    startedAt: ts("started_at"),
    completedAt: ts("completed_at"),
    expiresAt: ts("expires_at"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.requestedBy], foreignColumns: [memberships.tenantId, memberships.userId], name: "report_exports_requester_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.fileId], foreignColumns: [files.tenantId, files.id], name: "report_exports_file_fk" }),
    foreignKey({ columns: [t.tenantId, t.reportId], foreignColumns: [shiftReports.tenantId, shiftReports.id], name: "report_exports_report_fk" }),
    check("report_exports_format_check", sql`${t.format} IN ('pdf','xlsx','csv')`),
    check("report_exports_status_check", sql`${t.status} IN ('queued','running','done','failed')`),
    index("report_exports_user_idx").on(t.tenantId, t.requestedBy, t.createdAt.desc()),
    index("report_exports_sweep_idx").on(t.status, t.createdAt).where(sql`${t.status} in ('queued','running')`),
    index("report_exports_expiry_idx").on(t.tenantId, t.expiresAt).where(sql`${t.status} = 'done'`),
    tenantPolicy(),
  ],
).enableRLS()
