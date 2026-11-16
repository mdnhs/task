import { sql } from "drizzle-orm"
import { foreignKey, index, pgPolicy, pgTable, primaryKey, text, unique, uuid } from "drizzle-orm/pg-core"
import { memberships, tenants } from "./tenants"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })

/** Departments are teams with kind = 'department' (SRS A.5). */
export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["team", "department"] }).notNull().default("team"),
  },
  (t) => [unique("teams_tenant_name").on(t.tenantId, t.name), unique("teams_tenant_id_id").on(t.tenantId, t.id), tenantPolicy()],
).enableRLS()

// Composite FKs to memberships / teams keep every row inside ONE tenant: a user or team of another tenant cannot be linked.
export const teamMembers = pgTable(
  "team_members",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.teamId], foreignColumns: [teams.tenantId, teams.id], name: "team_members_team_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "team_members_member_fk" }).onDelete("cascade"),
    index("team_members_user_idx").on(t.tenantId, t.userId),
    tenantPolicy(),
  ],
).enableRLS()

/** One primary manager per member (user_id is the primary key); setting again replaces the row. */
export const reportingLines = pgTable(
  "reporting_lines",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    managerId: text("manager_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "reporting_lines_member_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.managerId], foreignColumns: [memberships.tenantId, memberships.userId], name: "reporting_lines_manager_fk" }).onDelete("cascade"),
    index("reporting_lines_manager_idx").on(t.tenantId, t.managerId),
    tenantPolicy(),
  ],
).enableRLS()
