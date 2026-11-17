import { sql } from "drizzle-orm"
import { boolean, check, date, foreignKey, index, integer, pgPolicy, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { memberships, tenants } from "./tenants"
import { teams } from "./teams"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })
const ts = (name: string) => timestamp(name, { withTimezone: true })

/**
 * A shift pattern (M1, FR-M1-20): wall-clock start/end read in `time_zone` (null = the tenant zone), the weekdays it STARTS on
 * (0 = Sunday ... 6 = Saturday). A pattern is never deleted, only archived (F14): reports, history and assignments keep pointing at it.
 * `version` is the optimistic-lock counter. The team FK has no cascade: a team that still has a pattern (archived or not) cannot be deleted.
 */
export const shiftPatterns = pgTable(
  "shift_patterns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull(),
    name: text("name").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    days: smallint("days").array().notNull(),
    timeZone: text("time_zone"),
    version: integer("version").notNull().default(1),
    archivedAt: ts("archived_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    unique("shift_patterns_tenant_id_id").on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id], name: "shift_patterns_team_fk" }),
    check("shift_patterns_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check("shift_patterns_start_check", sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("shift_patterns_end_check", sql`${t.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    // 1..7 weekday numbers 0..6 (the service stores them sorted and unique; a CHECK cannot hold a subquery to prove uniqueness)
    check("shift_patterns_days_check", sql`cardinality(${t.days}) BETWEEN 1 AND 7 AND ${t.days} <@ ARRAY[0,1,2,3,4,5,6]::smallint[]`),
    uniqueIndex("shift_patterns_team_name_uq").on(t.tenantId, t.teamId, t.name).where(sql`${t.archivedAt} is null`),
    index("shift_patterns_team_idx").on(t.tenantId, t.teamId).where(sql`${t.archivedAt} is null`),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * A member works a pattern from `from_date` to `until_date` (both inclusive, dates are shift START dates in the pattern's zone; null =
 * open-ended). Ending an assignment sets `until_date` (history kept); a row is deleted only while it has not started. Overlap per
 * (user, pattern) is refused by the service under SHIFT_LOCK_NS (no btree_gist). `created_by` is an actor id (a user or `apikey:<id>`),
 * so it carries no FK. A membership delete cascades (erasure, F22).
 */
export const shiftAssignments = pgTable(
  "shift_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    patternId: uuid("pattern_id").notNull(),
    fromDate: date("from_date", { mode: "string" }).notNull(),
    untilDate: date("until_date", { mode: "string" }),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    unique("shift_assignments_tenant_id_id").on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "shift_assignments_member_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.patternId], foreignColumns: [shiftPatterns.tenantId, shiftPatterns.id], name: "shift_assignments_pattern_fk" }),
    check("shift_assignments_dates_check", sql`${t.untilDate} is null or ${t.untilDate} >= ${t.fromDate}`),
    index("shift_assignments_user_idx").on(t.tenantId, t.userId, t.fromDate),
    index("shift_assignments_pattern_idx").on(t.tenantId, t.patternId),
    tenantPolicy(),
  ],
).enableRLS()

/** Team default for end-of-shift reporting (FR-M1-21). No row = off. */
export const shiftReportingTeams = pgTable(
  "shift_reporting_teams",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull(),
    on: boolean("on").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.teamId] }),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id], name: "shift_reporting_teams_team_fk" }).onDelete("cascade"),
    tenantPolicy(),
  ],
).enableRLS()

/** Per-person override of the team default (FR-M1-21). No row = follow the team; the override wins whichever team a shift belongs to. */
export const shiftReportingPeople = pgTable(
  "shift_reporting_people",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    on: boolean("on").notNull(),
    updatedBy: text("updated_by"),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "shift_reporting_people_member_fk" }).onDelete("cascade"),
    tenantPolicy(),
  ],
).enableRLS()
