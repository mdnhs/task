import { sql } from "drizzle-orm"
import { boolean, check, date, foreignKey, index, integer, jsonb, pgPolicy, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import type { EvidenceRule } from "@opsdesk/domain/task-evidence"
import type { RepeatRule } from "@opsdesk/domain/task-model"
import { memberships, tenants } from "./tenants"
import { teams } from "./teams"
import { files } from "./files"
import { projectMilestones, projects } from "./projects"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })
const ts = (name: string) => timestamp(name, { withTimezone: true })

export const TASK_STATUSES = ["not_started", "in_progress", "blocked", "submitted", "changes_requested", "completed", "cancelled"] as const

/** Per-tenant ref sequence (`TSK-<n>`): the row is updated inside the create tx, so concurrent creates are serialised and never collide. */
export const taskCounters = pgTable(
  "task_counters",
  {
    tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
    nextNo: integer("next_no").notNull().default(1000),
  },
  () => [tenantPolicy()],
).enableRLS()

/**
 * A task (M1, FR-M1-01..). `start_at`/`due_at` are UTC instants (ruling D3); the API speaks tenant wall clock. `version` is the
 * optimistic-lock counter (ruling D4): every mutation of task fields or status bumps it. `creator_id` is nulled on erasure (the
 * composite FK is MATCH SIMPLE, so null skips it). project_id / milestone_id / voice_file_id get their foreign keys with the tables
 * they point at (projects, T4.3; task files, T4.2).
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    refNo: integer("ref_no").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    teamId: uuid("team_id"),
    creatorId: text("creator_id"),
    priority: smallint("priority").notNull().default(2),
    startAt: ts("start_at").notNull(),
    dueAt: ts("due_at").notNull(),
    status: text("status").notNull().default("not_started"),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    estimateMin: integer("estimate_min"),
    client: text("client"),
    projectId: uuid("project_id"),
    milestoneId: uuid("milestone_id"),
    parentId: uuid("parent_id"),
    evidenceRule: jsonb("evidence_rule").$type<EvidenceRule>().notNull(),
    round: integer("round").notNull().default(1),
    repeat: jsonb("repeat").$type<RepeatRule>(),
    seriesId: uuid("series_id"),
    occurrenceDate: date("occurrence_date", { mode: "string" }),
    repeatCursor: date("repeat_cursor", { mode: "string" }),
    proposal: jsonb("proposal").$type<Record<string, unknown>>(),
    overduePlan: jsonb("overdue_plan").$type<{ reason: string; nextAction: string; owner: string; revisedDue: string }>(),
    voiceFileId: uuid("voice_file_id"),
    voiceMeta: jsonb("voice_meta").$type<Record<string, unknown>>(),
    submittedAt: ts("submitted_at"),
    completedAt: ts("completed_at"),
    archivedAt: ts("archived_at"),
    archivedBy: text("archived_by"),
    archiveBatchId: uuid("archive_batch_id"),
    version: integer("version").notNull().default(1),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    unique("tasks_tenant_ref").on(t.tenantId, t.refNo),
    unique("tasks_tenant_id_id").on(t.tenantId, t.id),
    check("tasks_title_check", sql`char_length(${t.title}) BETWEEN 1 AND 200`),
    check("tasks_description_check", sql`char_length(${t.description}) <= 10000`),
    check("tasks_priority_check", sql`${t.priority} BETWEEN 1 AND 3`),
    check("tasks_status_check", sql`${t.status} IN ('not_started','in_progress','blocked','submitted','changes_requested','completed','cancelled')`),
    check("tasks_dates_check", sql`${t.startAt} <= ${t.dueAt}`),
    // No cascade: removing a membership must not silently drop tasks (erasure nulls creator_id first).
    foreignKey({ columns: [t.tenantId, t.creatorId], foreignColumns: [memberships.tenantId, memberships.userId], name: "tasks_creator_fk" }),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id], name: "tasks_team_fk" }),
    foreignKey({ columns: [t.tenantId, t.parentId], foreignColumns: [t.tenantId, t.id], name: "tasks_parent_fk" }),
    // No cascade: the service unlinks a project's / milestone's tasks (with a history line each) before it deletes them.
    foreignKey({ columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id], name: "tasks_project_fk" }),
    // A task's milestone must belong to the task's own project (MATCH SIMPLE: skipped while milestone_id is null; the check forbids a milestone without a project).
    foreignKey({ columns: [t.tenantId, t.projectId, t.milestoneId], foreignColumns: [projectMilestones.tenantId, projectMilestones.projectId, projectMilestones.id], name: "tasks_milestone_fk" }),
    check("tasks_milestone_needs_project", sql`${t.milestoneId} is null or ${t.projectId} is not null`),
    // Recurrence (ruling D11, T4.4): one instance per (series, local date); the job's ON CONFLICT DO NOTHING rests on this key.
    unique("tasks_series_occ_uq").on(t.tenantId, t.seriesId, t.occurrenceDate),
    index("tasks_series_live_idx").on(t.tenantId).where(sql`${t.repeat} is not null and ${t.archivedAt} is null`),
    index("tasks_project_idx").on(t.tenantId, t.projectId).where(sql`${t.archivedAt} is null`),
    index("tasks_milestone_idx").on(t.tenantId, t.milestoneId).where(sql`${t.milestoneId} is not null`),
    index("tasks_live_due_idx").on(t.tenantId, t.dueAt, t.id).where(sql`${t.archivedAt} is null`),
    index("tasks_live_status_due_idx").on(t.tenantId, t.status, t.dueAt, t.id).where(sql`${t.archivedAt} is null`),
    // T4.5: the archive list and the retention job (archived rows only, newest first by scanning backwards), and the batch a restore brings back.
    index("tasks_archived_idx").on(t.tenantId, t.archivedAt, t.id).where(sql`${t.archivedAt} is not null`),
    index("tasks_archive_batch_idx").on(t.tenantId, t.archiveBatchId).where(sql`${t.archiveBatchId} is not null`),
    index("tasks_parent_idx").on(t.tenantId, t.parentId).where(sql`${t.parentId} is not null`),
    index("tasks_labels_gin").using("gin", t.labels),
    index("tasks_title_trgm_idx").using("gin", sql`lower(${t.title}) gin_trgm_ops`),
    tenantPolicy(),
  ],
).enableRLS()

/** One primary assignee per task (partial unique index) plus up to 9 others (FR-M1-01 "assignee(s)"). */
export const taskAssignees = pgTable(
  "task_assignees",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    userId: text("user_id").notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: "task_assignees_task_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "task_assignees_member_fk" }),
    uniqueIndex("task_assignees_primary_uidx").on(t.taskId).where(sql`${t.isPrimary}`),
    index("task_assignees_user_idx").on(t.tenantId, t.userId, t.taskId),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * Field history (FR-M1-12, AC-M1-04): raw old and new values in `changes` ({ field, from, to }); the DTO formats them in tenant time
 * with current names. `notified` = the members told in-app. `update_id` makes a shift-report / Today-card update idempotent.
 * actor_id is a user id, `apikey:<id>` or `system:<x>`; it is nulled for an erased person.
 */
export const taskHistory = pgTable(
  "task_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    at: ts("at").notNull(),
    actorId: text("actor_id"),
    kind: text("kind").notNull(),
    text: text("text"),
    changes: jsonb("changes").$type<{ field: string; from: unknown; to: unknown }[]>().notNull().default(sql`'[]'::jsonb`),
    notified: text("notified").array().notNull().default(sql`'{}'::text[]`),
    updateId: text("update_id"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: "task_history_task_fk" }).onDelete("cascade"),
    unique("task_history_update_uq").on(t.tenantId, t.taskId, t.updateId),
    index("task_history_task_idx").on(t.tenantId, t.taskId, t.at.desc(), t.id.desc()),
    tenantPolicy(),
  ],
).enableRLS()

/** Time logged against a task (shift reports, B5). `update_id` is unique per tenant, so a re-run adds nothing. user_id is nulled on erasure. */
export const taskTimeEntries = pgTable(
  "task_time_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    userId: text("user_id"),
    minutes: integer("minutes").notNull(),
    note: text("note").notNull().default(""),
    source: text("source").notNull().default(""),
    updateId: text("update_id").notNull(),
    at: ts("at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: "task_time_entries_task_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "task_time_entries_member_fk" }),
    unique("task_time_entries_update_uq").on(t.tenantId, t.updateId),
    check("task_time_entries_minutes_check", sql`${t.minutes} > 0`),
    index("task_time_entries_task_idx").on(t.tenantId, t.taskId),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * Checklist items of a task (FR-M1-02), at most 50 per task (the service counts under the task row lock). `done` is set absolutely;
 * done_by is a user id or `apikey:<id>` (no foreign key), nulled on erasure. Child rows never bump the task version (ruling D4).
 */
export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    text: text("text").notNull(),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull(),
    doneBy: text("done_by"),
    doneAt: ts("done_at"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: "task_checklist_items_task_fk" }).onDelete("cascade"),
    check("task_checklist_items_text_check", sql`char_length(${t.text}) BETWEEN 1 AND 200`),
    index("task_checklist_task_idx").on(t.tenantId, t.taskId, t.position, t.id),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * Comments (FR-M1-03, ruling D16): no edit, soft delete. `mentions` are the user ids the author named, stored as sent (the response
 * must not reveal who could see the task). author_id is a user id or `apikey:<id>`, nulled on erasure.
 */
export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    authorId: text("author_id"),
    body: text("body").notNull(),
    mentions: text("mentions").array().notNull().default(sql`'{}'::text[]`),
    attachmentFileIds: uuid("attachment_file_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: ts("created_at").notNull(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: "task_comments_task_fk" }).onDelete("cascade"),
    check("task_comments_body_check", sql`char_length(${t.body}) BETWEEN 1 AND 4000`),
    index("task_comments_task_idx").on(t.tenantId, t.taskId, t.createdAt, t.id),
    tenantPolicy(),
  ],
).enableRLS()

/** Files that belong to a task (ruling D9): reachable only through task routes. The `files` row carries the same purpose. */
export const TASK_FILE_PURPOSES = ["task_evidence", "task_attachment", "task_voice"] as const
export const taskFiles = pgTable(
  "task_files",
  {
    fileId: uuid("file_id").primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    purpose: text("purpose").notNull(),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: "task_files_task_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.fileId], foreignColumns: [files.tenantId, files.id], name: "task_files_file_fk" }),
    check("task_files_purpose_check", sql`${t.purpose} IN ('task_evidence','task_attachment','task_voice')`),
    index("task_files_task_idx").on(t.tenantId, t.taskId),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * Finish-to-start edges (FR-M1-02): `task_id` cannot start before `depends_on_id` is done. Edits take the tenant's TASK_GRAPH advisory
 * lock, so cycle checks never race. Edges leave with either task by the composite cascade foreign keys (purge).
 */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    dependsOnId: uuid("depends_on_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnId] }),
    check("task_dependencies_no_self", sql`${t.taskId} <> ${t.dependsOnId}`),
    foreignKey({ columns: [t.tenantId, t.taskId], foreignColumns: [tasks.tenantId, tasks.id], name: "task_dependencies_task_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.dependsOnId], foreignColumns: [tasks.tenantId, tasks.id], name: "task_dependencies_on_fk" }).onDelete("cascade"),
    index("task_deps_on_idx").on(t.tenantId, t.dependsOnId),
    tenantPolicy(),
  ],
).enableRLS()
