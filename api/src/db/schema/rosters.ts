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
    uniqueIndex("shift_types_location_name_uq").on(t.tenantId, t.locationId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
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
    index("member_qualifications_file_idx").on(t.tenantId, t.fileId), // the SET NULL file FK scans this on a file delete
    tenantPolicy(),
  ],
).enableRLS()

const HHMM = "^([01][0-9]|2[0-3]):[0-5][0-9]$"

/** One location's week (FR-RS-10): Monday-anchored, draft until published. `auto_repeat_days` (null = off) is read by the auto-repeat job. */
export const rosterWeeks = pgTable(
  "roster_weeks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull(),
    weekStart: date("week_start", { mode: "string" }).notNull(),
    status: text("status").notNull().default("draft"),
    publishedAt: ts("published_at"),
    publishedBy: text("published_by"),
    autoRepeatDays: smallint("auto_repeat_days"),
    version: integer("version").notNull().default(1),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    unique("roster_weeks_tenant_id_id").on(t.tenantId, t.id),
    unique("roster_weeks_id_location_uq").on(t.tenantId, t.id, t.locationId), // target of roster_shifts_week_fk: a shift's location is its week's location
    unique("roster_weeks_location_start_uq").on(t.tenantId, t.locationId, t.weekStart),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id], name: "roster_weeks_location_fk" }),
    check("roster_weeks_monday_check", sql`extract(isodow from ${t.weekStart}) = 1`),
    check("roster_weeks_status_check", sql`${t.status} in ('draft','published')`),
    check("roster_weeks_repeat_check", sql`${t.autoRepeatDays} is null or ${t.autoRepeatDays} BETWEEN 1 AND 365`),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * A shift in a week. `user_id` null = an open shift. The type's role/times/break are COPIED (a later edit of the type never rewrites a rostered shift).
 * `start_at`/`end_at` are the instants (wallToEpoch in the location zone). Deleting the member clears only user_id (tenant_id stays).
 */
export const rosterShifts = pgTable(
  "roster_shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    weekId: uuid("week_id").notNull(),
    locationId: uuid("location_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    userId: text("user_id"),
    shiftTypeId: uuid("shift_type_id").notNull(),
    role: text("role").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    unpaidBreakMin: smallint("unpaid_break_min").notNull().default(0),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    confirmedAt: ts("confirmed_at"),
    version: integer("version").notNull().default(1),
    sourceShiftId: uuid("source_shift_id"),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    unique("roster_shifts_tenant_id_id").on(t.tenantId, t.id),
    // the shift's week AND location must be one pair of roster_weeks (date-within-week stays a service-level rule)
    foreignKey({ columns: [t.tenantId, t.weekId, t.locationId], foreignColumns: [rosterWeeks.tenantId, rosterWeeks.id, rosterWeeks.locationId], name: "roster_shifts_week_fk" }),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id], name: "roster_shifts_location_fk" }),
    foreignKey({ columns: [t.tenantId, t.shiftTypeId], foreignColumns: [shiftTypes.tenantId, shiftTypes.id], name: "roster_shifts_type_fk" }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "roster_shifts_member_fk" }).onDelete("set null"), // column list added by hand in the SQL
    foreignKey({ columns: [t.tenantId, t.sourceShiftId], foreignColumns: [t.tenantId, t.id], name: "roster_shifts_source_fk" }).onDelete("set null"), // column list added by hand in the SQL
    check("roster_shifts_time_check", sql`${t.endAt} > ${t.startAt}`),
    check("roster_shifts_start_check", sql`${t.startTime} ~ '${sql.raw(HHMM)}'`),
    check("roster_shifts_end_check", sql`${t.endTime} ~ '${sql.raw(HHMM)}'`),
    check("roster_shifts_break_check", sql`${t.unpaidBreakMin} BETWEEN 0 AND 480`),
    check("roster_shifts_role_check", sql`char_length(${t.role}) BETWEEN 1 AND 80`),
    index("roster_shifts_user_idx").on(t.tenantId, t.userId, t.startAt),
    index("roster_shifts_location_date_idx").on(t.tenantId, t.locationId, t.date),
    index("roster_shifts_week_idx").on(t.tenantId, t.weekId),
    tenantPolicy(),
  ],
).enableRLS()

/**
 * Append-only roster change log (FR-RS-13). week_id and shift_id are plain ids, NOT foreign keys: the log outlives a deleted shift or week.
 * before/after are DTO snapshots the service decides (never more PII than the shift itself).
 */
export const rosterHistory = pgTable(
  "roster_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    weekId: uuid("week_id"),
    locationId: uuid("location_id").notNull(),
    shiftId: uuid("shift_id"),
    action: text("action").notNull(),
    actorId: text("actor_id").notNull(),
    reason: text("reason"),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id], name: "roster_history_location_fk" }),
    check("roster_history_action_check", sql`char_length(${t.action}) BETWEEN 1 AND 80`),
    index("roster_history_location_idx").on(t.tenantId, t.locationId, t.createdAt.desc(), t.id.desc()),
    tenantPolicy(),
  ],
).enableRLS()

/** A person asks to change a published shift (patch = the wanted fields); an office role decides (FR-RS-14). Deleting the person erases the request. */
export const rosterChangeRequests = pgTable(
  "roster_change_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id").notNull(),
    shiftVersion: integer("shift_version").notNull(), // roster_shifts.version at request time (stale_request check)
    requestedBy: text("requested_by").notNull(),
    patch: jsonb("patch").$type<Record<string, unknown>>().notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("requested"),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.shiftId], foreignColumns: [rosterShifts.tenantId, rosterShifts.id], name: "roster_change_requests_shift_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.requestedBy], foreignColumns: [memberships.tenantId, memberships.userId], name: "roster_change_requests_member_fk" }).onDelete("cascade"),
    check("roster_change_requests_status_check", sql`${t.status} in ('requested','approved','rejected')`),
    index("roster_change_requests_shift_idx").on(t.tenantId, t.shiftId),
    index("roster_change_requests_user_idx").on(t.tenantId, t.requestedBy),
    index("roster_change_requests_open_idx").on(t.tenantId, t.createdAt).where(sql`${t.status} = 'requested'`),
    tenantPolicy(),
  ],
).enableRLS()

/** A claim of an open shift or a swap of an assigned one (FR-RS-15). One OPEN exchange per (shift, requester, kind); a decided one frees the slot. */
export const rosterExchanges = pgTable(
  "roster_exchanges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    shiftId: uuid("shift_id").notNull(),
    fromUserId: text("from_user_id").notNull(),
    toUserId: text("to_user_id"),
    status: text("status").notNull().default("requested"),
    note: text("note").notNull().default(""),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.shiftId], foreignColumns: [rosterShifts.tenantId, rosterShifts.id], name: "roster_exchanges_shift_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.fromUserId], foreignColumns: [memberships.tenantId, memberships.userId], name: "roster_exchanges_from_fk" }).onDelete("cascade"),
    foreignKey({ columns: [t.tenantId, t.toUserId], foreignColumns: [memberships.tenantId, memberships.userId], name: "roster_exchanges_to_fk" }).onDelete("set null"), // column list added by hand in the SQL
    check("roster_exchanges_kind_check", sql`${t.kind} in ('claim','swap')`),
    check("roster_exchanges_status_check", sql`${t.status} in ('requested','recommended','approved','rejected','cancelled')`),
    uniqueIndex("roster_exchanges_open_uq").on(t.tenantId, t.shiftId, t.fromUserId, t.kind).where(sql`${t.status} in ('requested','recommended')`),
    index("roster_exchanges_shift_idx").on(t.tenantId, t.shiftId),
    index("roster_exchanges_from_idx").on(t.tenantId, t.fromUserId),
    index("roster_exchanges_to_idx").on(t.tenantId, t.toUserId),
    tenantPolicy(),
  ],
).enableRLS()

/** Time off (FR-RS-20), whole dates inclusive. */
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    fromDate: date("from_date", { mode: "string" }).notNull(),
    toDate: date("to_date", { mode: "string" }).notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("requested"),
    note: text("note").notNull().default(""),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "leave_requests_member_fk" }).onDelete("cascade"),
    check("leave_requests_dates_check", sql`${t.toDate} >= ${t.fromDate}`),
    check("leave_requests_status_check", sql`${t.status} in ('requested','approved','rejected','cancelled')`),
    check("leave_requests_kind_check", sql`char_length(${t.kind}) BETWEEN 1 AND 40`),
    index("leave_requests_user_idx").on(t.tenantId, t.userId, t.fromDate),
    index("leave_requests_status_idx").on(t.tenantId, t.status),
    tenantPolicy(),
  ],
).enableRLS()

/** A "not available" window on a weekday (0 = Sunday ... 6). A window that crosses midnight is two rows (the service splits it), so from < to; to may be 24:00. */
export const rosterAvailability = pgTable(
  "roster_availability",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    weekday: smallint("weekday").notNull(),
    fromTime: text("from_time").notNull(),
    toTime: text("to_time").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.weekday, t.fromTime, t.toTime] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "roster_availability_member_fk" }).onDelete("cascade"),
    check("roster_availability_weekday_check", sql`${t.weekday} BETWEEN 0 AND 6`),
    check("roster_availability_from_check", sql`${t.fromTime} ~ '${sql.raw(HHMM)}'`),
    check("roster_availability_to_check", sql`${t.toTime} ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'`),
    check("roster_availability_order_check", sql`${t.fromTime} < ${t.toTime}`),
    tenantPolicy(),
  ],
).enableRLS()

/** A saved week layout of a location (FR-RS-12). `shifts` is the service's validated list; the DB only keeps it. */
export const rosterWeekTemplates = pgTable(
  "roster_week_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").notNull(),
    name: text("name").notNull(),
    shifts: jsonb("shifts").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    createdBy: text("created_by"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    unique("roster_week_templates_name_uq").on(t.tenantId, t.locationId, t.name),
    foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id], name: "roster_week_templates_location_fk" }),
    check("roster_week_templates_name_check", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check("roster_week_templates_shifts_check", sql`jsonb_typeof(${t.shifts}) = 'array'`),
    tenantPolicy(),
  ],
).enableRLS()

/** Exactly-once ledger of the auto-repeat job: one row per (source week, target week start) it copied. */
export const rosterAutoRepeatRuns = pgTable(
  "roster_auto_repeat_runs",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    sourceWeekId: uuid("source_week_id").notNull(),
    targetWeekStart: date("target_week_start", { mode: "string" }).notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.sourceWeekId, t.targetWeekStart] }),
    foreignKey({ columns: [t.tenantId, t.sourceWeekId], foreignColumns: [rosterWeeks.tenantId, rosterWeeks.id], name: "roster_auto_repeat_runs_week_fk" }).onDelete("cascade"),
    tenantPolicy(),
  ],
).enableRLS()

/** Exactly-once ledger of the expiry-notice job: one row per (person, qualification type, expiry date, lead days) already notified. */
export const qualificationExpiryNotices = pgTable(
  "qualification_expiry_notices",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    expiresOn: date("expires_on", { mode: "string" }).notNull(),
    leadDays: smallint("lead_days").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.type, t.expiresOn, t.leadDays] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [memberships.tenantId, memberships.userId], name: "qualification_expiry_notices_member_fk" }).onDelete("cascade"),
    tenantPolicy(),
  ],
).enableRLS()
