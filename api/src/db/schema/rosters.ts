import { sql } from "drizzle-orm"
import { boolean, check, date, doublePrecision, foreignKey, index, integer, jsonb, pgPolicy, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { files } from "./files"
import { memberships, tenants } from "./tenants"

// Standard RLS template (R8); FORCE is appended by hand in the migration.
const tenantMatch = sql`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
const tenantPolicy = () => pgPolicy("tenant_isolation", { as: "permissive", for: "all", using: tenantMatch, withCheck: tenantMatch })
const ts = (name: string) => timestamp(name, { withTimezone: true })

/**
 * A work site (M1A, FR-RS-01..): rosters, shift types and supervisor grants hang off it. `time_zone` null = the tenant zone (a valid IANA name
 * is checked by the service). A location is archived, never deleted. `version` is the optimistic-lock counter.
 */
export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    zoneRadiusM: integer("zone_radius_m"),
    openingHours: jsonb("opening_hours").$type<Record<string, unknown>>().notNull().default({}),
    contact: text("contact").notNull().default(""),
    swapApprovalDelegated: boolean("swap_approval_delegated").notNull().default(false),
    timeZone: text("time_zone"),
    version: integer("version").notNull().default(1),
    archivedAt: ts("archived_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    unique("locations_tenant_id_id").on(t.tenantId, t.id),
    check("locations_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 120`),
    check("locations_radius_check", sql`${t.zoneRadiusM} is null or ${t.zoneRadiusM} BETWEEN 0 AND 5000`),
    check("locations_lat_check", sql`${t.lat} is null or ${t.lat} BETWEEN -90 AND 90`),
    check("locations_lng_check", sql`${t.lng} is null or ${t.lng} BETWEEN -180 AND 180`),
    uniqueIndex("locations_name_uq").on(t.tenantId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    tenantPolicy(),
  ],
).enableRLS()

/** A location supervisor's grant (FR-RS-03): the person supervises this site. A membership delete cascades (erasure). */
export const locationSupervisors = pgTable(
  "location_supervisors",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull(),
    userId: text("user_id").notNull(),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.locationId, t.userId] }),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id], name: "location_supervisors_location_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "location_supervisors_member_fk" }).onDelete("cascade"),
    index("location_supervisors_user_idx").on(t.tenantId, t.userId),
    tenantPolicy(),
  ],
).enableRLS()

/** A Roster Manager's "all except" list (FR-RS-04): sites this office person does NOT manage. */
export const rosterOfficeLimits = pgTable(
  "roster_office_limits",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    locationId: uuid("location_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.locationId] }),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id], name: "roster_office_limits_location_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "roster_office_limits_member_fk" }).onDelete("cascade"),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * A reusable shift of a location: wall-clock start/end (the HH:MM checks of `shift_patterns`). end <= start means the shift ends the next day,
 * so there is deliberately NO check on end > start. `requires` lists qualification types a person needs. Archived, never deleted.
 */
export const shiftTypes = pgTable(
  "shift_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull(),
    name: text("name").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    unpaidBreakMin: smallint("unpaid_break_min").notNull().default(0),
    role: text("role").notNull(),
    requires: text("requires").array().notNull().default(sql`'{}'::text[]`),
    archivedAt: ts("archived_at"),
    version: integer("version").notNull().default(1),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    unique("shift_types_tenant_id_id").on(t.tenantId, t.id),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id], name: "shift_types_location_fk" }),
    check("shift_types_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check("shift_types_start_check", sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("shift_types_end_check", sql`${t.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check("shift_types_break_check", sql`${t.unpaidBreakMin} BETWEEN 0 AND 480`),
    check("shift_types_role_check", sql`char_length(${t.role}) BETWEEN 1 AND 80`),
    uniqueIndex("shift_types_location_name_uq").on(t.tenantId, t.locationId, t.name).where(sql`${t.archivedAt} is null`),
    index("shift_types_location_idx").on(t.tenantId, t.locationId).where(sql`${t.archivedAt} is null`),
    tenantPolicy(),
  ],
).enableRLS()

/** How many people a shift type wants per weekday (0 = Sunday ... 6 = Saturday); the coverage target (FR-RS-30). */
export const shiftTypeTargets = pgTable(
  "shift_type_targets",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    shiftTypeId: uuid("shift_type_id").notNull(),
    weekday: smallint("weekday").notNull(),
    count: smallint("count").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.shiftTypeId, t.weekday] }),
    foreignKey({ columns: [t.tenantId, t.shiftTypeId], foreignColumns: [shiftTypes.tenantId, shiftTypes.id], name: "shift_type_targets_type_fk" }).onDelete("cascade"),
    check("shift_type_targets_weekday_check", sql`${t.weekday} BETWEEN 0 AND 6`),
    check("shift_type_targets_count_check", sql`${t.count} BETWEEN 0 AND 99`),
    tenantPolicy(),
  ],
).enableRLS()

/** A licence or certificate a member holds (FR-RS-40). `file_id` is the proof file; deleting the file clears only that column (tenant_id stays). */
export const memberQualifications = pgTable(
  "member_qualifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    expiresOn: date("expires_on", { mode: "string" }),
    fileId: uuid("file_id"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    unique("member_qualifications_tenant_id_id").on(t.tenantId, t.id),
    unique("member_qualifications_key").on(t.tenantId, t.userId, t.type),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "member_qualifications_member_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.fileId], foreignColumns: [files.tenantId, files.id], name: "member_qualifications_file_fk" }).onDelete("set null"),
    check("member_qualifications_type_check", sql`char_length(${t.type}) BETWEEN 1 AND 80`),
    index("member_qualifications_expiry_idx").on(t.tenantId, t.expiresOn).where(sql`${t.expiresOn} is not null`),
    tenantPolicy(),
  ],
).enableRLS()
