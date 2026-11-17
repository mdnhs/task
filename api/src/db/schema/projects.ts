import { sql } from "drizzle-orm"
import { check, date, foreignKey, index, integer, jsonb, pgPolicy, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core"
import type { EvidenceRule } from "@opsdesk/domain/task-evidence"
import { memberships, tenants } from "./tenants"
import { teams } from "./teams"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })
const ts = (name: string) => timestamp(name, { withTimezone: true })

/**
 * A project (M1, FR-M1-04). `due_date` is a tenant-local calendar day (ruling D3). `default_evidence_rule` is read by task creation
 * later (ruling D23). `version` is the optimistic-lock counter of the project's own fields (milestones are child rows and do not bump it).
 * lead_id is nulled on erasure (the composite FK is MATCH SIMPLE).
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    teamId: uuid("team_id"),
    leadId: text("lead_id"),
    description: text("description").notNull().default(""),
    dueDate: date("due_date", { mode: "string" }),
    defaultEvidenceRule: jsonb("default_evidence_rule").$type<EvidenceRule>(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique("projects_tenant_id_id").on(t.tenantId, t.id),
    check("projects_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check("projects_description_check", sql`char_length(${t.description}) <= 4000`),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id], name: "projects_team_fk" }),
    foreignKey({ columns: [t.tenantId, t.leadId], foreignColumns: [memberships.tenantId, memberships.userId], name: "projects_lead_fk" }),
    index("projects_created_idx").on(t.tenantId, t.createdAt.desc(), t.id.desc()),
    tenantPolicy(),
  ],
).enableRLS()

/** A dated stage of a project. Deleting the project removes its milestones (cascade); the service unlinks tasks first. */
export const projectMilestones = pgTable(
  "project_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    unique("project_milestones_tenant_id_id").on(t.tenantId, t.id),
    unique("project_milestones_tenant_project_id").on(t.tenantId, t.projectId, t.id),
    check("project_milestones_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    foreignKey({ columns: [t.tenantId, t.projectId], foreignColumns: [projects.tenantId, projects.id], name: "project_milestones_project_fk" }).onDelete("cascade"),
    index("project_milestones_project_idx").on(t.tenantId, t.projectId, t.dueDate, t.id),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * A reusable task blueprint (FR-TASK-10, T4.4). It never holds a voice note (ruling D21). `due_offset_days` is days after the start date,
 * `due_time` a tenant-local HH:mm. `assignee_id` and `created_by` are nulled on erasure (composite FKs are MATCH SIMPLE). `team_id` is a
 * department (checked by the service); deleting that team clears it (the team delete does it, as for projects).
 */
export const taskTemplates = pgTable(
  "task_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    teamId: uuid("team_id"),
    assigneeId: text("assignee_id"),
    priority: smallint("priority").notNull().default(2),
    labels: text("labels").array().notNull().default(sql`'{}'::text[]`),
    evidenceRule: jsonb("evidence_rule").$type<EvidenceRule>().notNull(),
    dueOffsetDays: integer("due_offset_days").notNull().default(0),
    dueTime: text("due_time").notNull().default("17:00"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    unique("task_templates_tenant_id_id").on(t.tenantId, t.id),
    check("task_templates_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check("task_templates_title_check", sql`char_length(${t.title}) BETWEEN 1 AND 200`),
    check("task_templates_description_check", sql`char_length(${t.description}) <= 10000`),
    check("task_templates_priority_check", sql`${t.priority} BETWEEN 1 AND 3`),
    check("task_templates_offset_check", sql`${t.dueOffsetDays} BETWEEN 0 AND 365`),
    check("task_templates_time_check", sql`${t.dueTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id], name: "task_templates_team_fk" }),
    foreignKey({ columns: [t.tenantId, t.assigneeId], foreignColumns: [memberships.tenantId, memberships.userId], name: "task_templates_assignee_fk" }),
    foreignKey({ columns: [t.tenantId, t.createdBy], foreignColumns: [memberships.tenantId, memberships.userId], name: "task_templates_creator_fk" }),
    index("task_templates_list_idx").on(t.tenantId, t.name, t.id),
    tenantPolicy(),
  ],
).enableRLS()
