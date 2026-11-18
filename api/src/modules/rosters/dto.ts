import { z } from "@hono/zod-openapi"

const LID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
const STID = "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90"
const UID = "usr_8Kq2mZ4tW1"

/**
 * Loose on purpose: a roster id of any other shape must answer EXACTLY like one that does not exist (404, R8-4), never a 400 that tells a prober
 * the id was malformed. The services turn a non-uuid into the same 404 before an id reaches SQL (scope.ts `assertLocation`, `uuidOr404`).
 */
export const RosterIdParam = z.object({ id: z.string().min(1).max(64) })
export const RosterUserParam = z.object({ userId: z.string().min(1).max(128) })

// ------------------------------------------------------------------ locations

/** Free-form per-day opening text (e.g. mon: "08:00-22:00"), at most 14 entries: the UI shows it, nothing computes with it. */
const OpeningHours = z.record(z.string().max(20), z.string().max(100))

export const LocationOut = z.object({
  id: z.uuid(), name: z.string(), address: z.string(), lat: z.number().nullable(), lng: z.number().nullable(), zoneRadiusM: z.number().int().nullable(),
  openingHours: OpeningHours, contact: z.string(), swapApprovalDelegated: z.boolean(), timeZone: z.string().nullable(), version: z.number().int(),
  archived: z.boolean(), supervisorIds: z.array(z.string()),
})
export type LocationDto = z.infer<typeof LocationOut>

const locationEx = {
  id: LID, name: "Harbour Street", address: "1 Harbour Street, Dublin", lat: 53.3498, lng: -6.2603, zoneRadiusM: 150, openingHours: { mon: "08:00-22:00" }, contact: "+353 1 555 0100",
  swapApprovalDelegated: false, timeZone: null, version: 1, archived: false, supervisorIds: [UID],
}
export const LocationSchema = LocationOut.openapi({ example: locationEx })
export const LocationsOut = z.object({ items: z.array(LocationOut) }).openapi({ example: { items: [locationEx] } })
export const LocationsQuery = z.object({ includeArchived: z.enum(["true", "false"]).optional().openapi({ description: "Also list archived locations (default false)", example: "false" }) })

// Loose number/string types: the service validates (ranges, IANA zone) and answers 422 with a specific code instead of the generic 400.
const Text = z.string().max(400)
export const CreateLocationBody = z
  .object({
    name: z.string().max(200), address: Text.optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), zoneRadiusM: z.number().nullable().optional(),
    openingHours: OpeningHours.optional(), contact: Text.optional(), swapApprovalDelegated: z.boolean().optional(), timeZone: z.string().max(100).nullable().optional(),
  })
  .openapi({ example: { name: "Harbour Street", address: "1 Harbour Street, Dublin", lat: 53.3498, lng: -6.2603, zoneRadiusM: 150, timeZone: "Europe/Dublin" } })
export const PatchLocationBody = z
  .object({
    version: z.number().int().min(1), name: z.string().max(200).optional(), address: Text.optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional(),
    zoneRadiusM: z.number().nullable().optional(), openingHours: OpeningHours.optional(), contact: Text.optional(), swapApprovalDelegated: z.boolean().optional(), timeZone: z.string().max(100).nullable().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== "version" && (v as Record<string, unknown>)[k] !== undefined), { message: "nothing to change" })
  .openapi({ example: { version: 1, contact: "+353 1 555 0101", swapApprovalDelegated: true } })

export const SupervisorsBody = z.object({ userIds: z.array(z.string().min(1).max(128)).max(100) }).openapi({ example: { userIds: [UID] } })
export const SupervisorsOut = z.object({ locationId: z.uuid(), userIds: z.array(z.string()) }).openapi({ example: { locationId: LID, userIds: [UID] } })

// ------------------------------------------------------------------ shift types

const TargetOut = z.object({ weekday: z.number().int(), count: z.number().int() })
export const ShiftTypeOut = z.object({
  id: z.uuid(), locationId: z.uuid(), name: z.string(), start: z.string(), end: z.string(), unpaidBreakMin: z.number().int(), role: z.string(), requires: z.array(z.string()),
  targets: z.array(TargetOut), archived: z.boolean(), version: z.number().int(),
})
export type ShiftTypeDto = z.infer<typeof ShiftTypeOut>
const shiftTypeEx = {
  id: STID, locationId: LID, name: "Night", start: "22:00", end: "06:00", unpaidBreakMin: 30, role: "Security officer", requires: ["SIA licence"],
  targets: [{ weekday: 1, count: 2 }, { weekday: 5, count: 3 }], archived: false, version: 1,
}
export const ShiftTypeSchema = ShiftTypeOut.openapi({ example: shiftTypeEx })
export const ShiftTypesOut = z.object({ items: z.array(ShiftTypeOut) }).openapi({ example: { items: [shiftTypeEx] } })
export const ShiftTypesQuery = z.object({ includeArchived: z.enum(["true", "false"]).optional().openapi({ description: "Also list archived types (default false); rostered shifts keep their type either way", example: "false" }) })

const Hm = z.string().max(10)
const Requires = z.array(z.string().max(200)).max(100)
export const CreateShiftTypeBody = z
  .object({ name: z.string().max(200), start: Hm, end: Hm, unpaidBreakMin: z.number().optional(), role: z.string().max(200), requires: Requires.optional() })
  .openapi({ example: { name: "Night", start: "22:00", end: "06:00", unpaidBreakMin: 30, role: "Security officer", requires: ["SIA licence"] } })
export const PatchShiftTypeBody = z
  .object({ version: z.number().int().min(1), name: z.string().max(200).optional(), start: Hm.optional(), end: Hm.optional(), unpaidBreakMin: z.number().optional(), role: z.string().max(200).optional(), requires: Requires.optional() })
  .refine((v) => Object.keys(v).some((k) => k !== "version" && (v as Record<string, unknown>)[k] !== undefined), { message: "nothing to change" })
  .openapi({ example: { version: 1, end: "07:00" } })
export const TargetsBody = z
  .object({ targets: z.array(z.object({ weekday: z.number(), count: z.number() })).max(7) })
  .openapi({ example: { targets: [{ weekday: 1, count: 2 }, { weekday: 5, count: 3 }] } })

// ------------------------------------------------------------------ office limits

export const OfficeLimitBody = z.object({ except: z.array(z.string().max(64)).max(500) }).openapi({ example: { except: [LID] } })
export const OfficeLimitOut = z.object({ userId: z.string(), except: z.array(z.uuid()) }).openapi({ example: { userId: UID, except: [LID] } })

// ------------------------------------------------------------------ member qualifications and home location

const QualOut = z.object({ type: z.string(), expiresOn: z.string().nullable(), expired: z.boolean() })
export const QualificationsOut = z
  .object({ userId: z.string(), items: z.array(QualOut) })
  .openapi({ example: { userId: UID, items: [{ type: "SIA licence", expiresOn: "2027-03-31", expired: false }, { type: "First aid", expiresOn: null, expired: false }] } })
export type QualificationsDto = z.infer<typeof QualificationsOut>
export const QualificationsBody = z
  .object({ qualifications: z.array(z.object({ type: z.string().max(200), expiresOn: z.string().max(10).nullable().optional() })).max(100) })
  .openapi({ example: { qualifications: [{ type: "SIA licence", expiresOn: "2027-03-31" }, { type: "First aid", expiresOn: null }] } })

export const HomeLocationBody = z.object({ locationId: z.string().max(64).nullable() }).openapi({ example: { locationId: LID } })
export const HomeLocationOut = z.object({ userId: z.string(), homeLocationId: z.uuid().nullable() }).openapi({ example: { userId: UID, homeLocationId: LID } })

// ------------------------------------------------------------------ leave and availability (FR-RS-41)

const LEAVE_ID = "3f2b8c1d-6a47-4e0b-9d15-2c7e5a9b4f10"
export const LeaveOut = z.object({
  id: z.uuid(), userId: z.string(), from: z.string(), to: z.string(), kind: z.string(), status: z.enum(["requested", "approved", "rejected", "cancelled"]), note: z.string(),
  decidedBy: z.string().nullable(), decidedAt: z.string().nullable(), decisionNote: z.string().nullable(), createdAt: z.string(),
})
export type LeaveDto = z.infer<typeof LeaveOut>
const leaveEx = {
  id: LEAVE_ID, userId: UID, from: "2026-12-01", to: "2026-12-05", kind: "annual", status: "requested", note: "Family trip", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-11-16T09:00:00.000Z",
}
export const LeaveSchema = LeaveOut.openapi({ example: leaveEx })
export const LeaveListOut = z
  .object({ items: z.array(LeaveOut), nextCursor: z.string().nullable() })
  .openapi({ example: { items: [leaveEx], nextCursor: "MjAyNi0xMS0xNlQwOTowMDowMC4wMDBafDNmMmI4YzFkLTZhNDctNGUwYi05ZDE1LTJjN2U1YTliNGYxMA" } })
// Loose strings: the service validates and answers 422 with a specific code instead of the generic 400.
export const LeaveQuery = z.object({
  status: z.string().max(20).optional().openapi({ description: "requested | approved | rejected | cancelled", example: "requested" }),
  userId: z.string().max(128).optional().openapi({ example: UID }),
  from: z.string().max(10).optional().openapi({ description: "Leave that ends on or after this date (YYYY-MM-DD)", example: "2026-12-01" }),
  to: z.string().max(10).optional().openapi({ description: "Leave that starts on or before this date (YYYY-MM-DD)", example: "2026-12-31" }),
  limit: z.string().max(5).optional().openapi({ description: "Page size 1..200 (default 50); anything else is 422 invalid_filter", example: "50" }),
  cursor: z.string().max(200).optional().openapi({ description: "The nextCursor of the previous page (newest first, keyset on creation time and id); garbage is 400 invalid_cursor", example: "MjAyNi0xMS0xNlQwOTowMDowMC4wMDBafDNmMmI4YzFkLTZhNDctNGUwYi05ZDE1LTJjN2U1YTliNGYxMA" }),
})
export const CreateLeaveBody = z
  .object({ from: z.string().max(10), to: z.string().max(10), kind: z.string().max(100), note: z.string().max(2000).optional() })
  .openapi({ example: { from: "2026-12-01", to: "2026-12-05", kind: "annual", note: "Family trip" } })
export const DecideLeaveBody = z
  .object({ decision: z.enum(["approve", "reject"]), note: z.string().max(2000).optional() })
  .openapi({ example: { decision: "approve", note: "Enjoy the break" } })
const WindowOut = z.object({ weekday: z.number().int(), from: z.string(), to: z.string() })
export const AvailabilityOut = z.object({ windows: z.array(WindowOut) }).openapi({ example: { windows: [{ weekday: 1, from: "09:00", to: "12:00" }, { weekday: 5, from: "22:00", to: "24:00" }, { weekday: 6, from: "00:00", to: "06:00" }] } })
export type AvailabilityDto = z.infer<typeof AvailabilityOut>
export const AvailabilityBody = z
  .object({ windows: z.array(z.object({ weekday: z.number(), from: z.string().max(10), to: z.string().max(10) })).max(500) })
  .openapi({ example: { windows: [{ weekday: 1, from: "09:00", to: "12:00" }, { weekday: 5, from: "22:00", to: "06:00" }] } })

// ------------------------------------------------------------------ rule engine (FR-RS-44)

const WEEK_ID = "5d8b2f4a-1c3e-4a7b-8f60-9e2d1c0b3a44"
const severityEx = { double_booking: "block", approved_leave: "block", unavailable: "warn", daily_rest: "warn", weekly_rest: "warn", avg_48h: "warn", expired_licence: "warn", left: "warn" }
export const RulesOut = z
  .object({ severity: z.record(z.string(), z.enum(["block", "warn", "ignore"])), avgWeekReferenceWeeks: z.number().int(), draftWarnDays: z.number().int().openapi({ description: "Days before a week starts that a still-unpublished draft becomes an attention item (0..28, default 3)" }) })
  .openapi({ example: { severity: severityEx, avgWeekReferenceWeeks: 17, draftWarnDays: 3 } })
export type RulesDto = z.infer<typeof RulesOut>
// Loose on purpose: the service answers 422 invalid_rules / invalid_avg_weeks with a specific code instead of the generic 400.
export const RulesBody = z
  .object({ severity: z.record(z.string().max(40), z.string().max(20)), avgWeekReferenceWeeks: z.number().optional(), draftWarnDays: z.number().optional() })
  .openapi({ example: { severity: { daily_rest: "block" }, avgWeekReferenceWeeks: 26, draftWarnDays: 3 } })
export const RulesHeaders = z.object({
  "if-match": z.string().optional().openapi({ description: "The ETag of the settings the edit started from (GET /v1/roster/rules). Required: missing is 428 precondition_required, stale is 412 precondition_failed (the current ETag in the ETag header). Strong comparison; a weak tag or * never matches", example: '"3f2a9c0d1b7e4a58c6d2e9f01a4b7c3d"' }),
})
const ViolationOut = z.object({
  rule: z.enum(["double_booking", "approved_leave", "unavailable", "daily_rest", "weekly_rest", "avg_48h", "expired_licence", "left", "elsewhere"]), shiftId: z.string(), personId: z.string(),
  severity: z.enum(["block", "warn"]), message: z.string(), otherShiftIds: z.array(z.string()),
})
export const CheckOut = z
  .object({ weekId: z.uuid(), violations: z.array(ViolationOut), blocking: z.number().int() })
  .openapi({
    example: {
      weekId: WEEK_ID,
      violations: [{ rule: "daily_rest", shiftId: LEAVE_ID, personId: UID, severity: "warn", message: "Aoife Byrne has only 10h00 rest between 2026-11-02 08:00-16:00 and 2026-11-03 02:00-10:00", otherShiftIds: [STID] }],
      blocking: 0,
    },
  })

// ------------------------------------------------------------------ weeks and shifts (FR-RS-10, 20..22)

const SHIFT_ID = "9a1c6b3e-2d4f-4e58-b7a9-1f3c5d7e9b02"
const instantEx = "2026-11-02T08:00:00.000Z"
export const ShiftOut = z.object({
  id: z.uuid(), weekId: z.uuid(), locationId: z.uuid(), date: z.string(), userId: z.string().nullable(), shiftTypeId: z.uuid(), role: z.string(), start: z.string(), end: z.string(),
  unpaidBreakMin: z.number().int(), startAt: z.string(), endAt: z.string(), confirmedAt: z.string().nullable(), version: z.number().int(),
})
export type ShiftDto = z.infer<typeof ShiftOut>
const shiftEx = { id: SHIFT_ID, weekId: WEEK_ID, locationId: LID, date: "2026-11-02", userId: UID, shiftTypeId: STID, role: "Security officer", start: "08:00", end: "16:00", unpaidBreakMin: 30, startAt: instantEx, endAt: "2026-11-02T16:00:00.000Z", confirmedAt: null, version: 1 }
export const ShiftSchema = ShiftOut.openapi({ example: shiftEx })

const DayOut = z.object({ date: z.string(), shiftIds: z.array(z.uuid()), count: z.number().int(), target: z.number().int(), short: z.number().int(), over: z.number().int() })
export const WeekOut = z.object({
  id: z.uuid(), locationId: z.uuid(), weekStart: z.string(), status: z.enum(["draft", "published"]), publishedAt: z.string().nullable(), publishedBy: z.string().nullable(), autoRepeatDays: z.number().int().nullable(),
  version: z.number().int(), days: z.array(DayOut),
})
export type WeekDto = z.infer<typeof WeekOut>
const weekEx = {
  id: WEEK_ID, locationId: LID, weekStart: "2026-11-02", status: "draft", publishedAt: null, publishedBy: null, autoRepeatDays: null, version: 1,
  days: [{ date: "2026-11-02", shiftIds: [SHIFT_ID], count: 1, target: 2, short: 1, over: 0 }],
}
export const WeekSchema = WeekOut.openapi({ example: weekEx })
const MemberOut = z.object({ userId: z.string(), name: z.string(), active: z.boolean(), homeLocationId: z.uuid().nullable() })
export const WeeksOut = z
  .object({ range: z.object({ from: z.string(), to: z.string(), view: z.enum(["day", "week", "fortnight", "month"]) }), weeks: z.array(WeekOut), shifts: z.array(ShiftOut), shiftTypes: z.array(ShiftTypeOut), members: z.array(MemberOut), membersTruncated: z.boolean() })
  .openapi({ example: { range: { from: "2026-11-02", to: "2026-11-08", view: "week" }, weeks: [weekEx], shifts: [shiftEx], shiftTypes: [shiftTypeEx], members: [{ userId: UID, name: "Aoife Byrne", active: true, homeLocationId: LID }], membersTruncated: false } })
export type WeeksDto = z.infer<typeof WeeksOut>
export const WeeksQuery = z.object({
  locationId: z.string().max(64).optional().openapi({ description: "One location (404 when the caller may not see it); omitted: every location the caller sees", example: LID }),
  from: z.string().max(10).optional().openapi({ description: "Anchor date YYYY-MM-DD (default: today in the tenant zone)", example: "2026-11-02" }),
  to: z.string().max(10).optional().openapi({ description: "Explicit last date (at most 62 days after `from`); without it the `view` decides", example: "2026-11-30" }),
  view: z.string().max(12).optional().openapi({ description: "day | week | fortnight | month (default week); anything else is 422 invalid_view", example: "week" }),
})
export const CreateWeekBody = z.object({ locationId: z.string().max(64), weekStart: z.string().max(10) }).openapi({ example: { locationId: LID, weekStart: "2026-11-09" } })
const Reason = z.string().max(2000)
export const AddShiftsBody = z
  .object({
    shifts: z
      .array(z.object({ date: z.string().max(10), userIds: z.array(z.string().max(128).nullable()).max(50), shiftTypeId: z.string().max(64), role: z.string().max(200).optional(), start: z.string().max(10).optional(), end: z.string().max(10).optional(), unpaidBreakMin: z.number().optional() }))
      .max(50),
    reason: Reason.optional(),
    overrideRuleIds: z.array(z.string().max(40)).max(20).optional(),
  })
  .openapi({ example: { shifts: [{ date: "2026-11-02", userIds: [UID, null], shiftTypeId: STID, start: "08:00", end: "16:00" }] } })
export const AddShiftsOut = z
  .object({ shifts: z.array(ShiftOut), violations: z.array(ViolationOut) })
  .openapi({ example: { shifts: [shiftEx], violations: [] } })
export const PatchShiftBody = z
  .object({ version: z.number().int().min(1), patch: z.record(z.string().max(40), z.unknown()), reason: Reason.optional(), overrideRuleIds: z.array(z.string().max(40)).max(20).optional() })
  .openapi({ example: { version: 1, patch: { start: "09:00", end: "17:00" } } })
export const PatchShiftOut = z.object({ shift: ShiftOut, violations: z.array(ViolationOut) }).openapi({ example: { shift: shiftEx, violations: [] } })
export const DeleteShiftQuery = z.object({
  version: z.string().max(9).optional().openapi({ description: "The shift version the editor saw; a stale one is 409 version_conflict", example: "1" }),
  reason: z.string().max(2000).optional().openapi({ description: "Why (required from an office role on a published week)", example: "Cover found" }),
})

// ------------------------------------------------------------------ repeat, week templates, auto-repeat (FR-RS-26..29)

const CONFLICT_REASONS = ["double_booking", "approved_leave", "unavailable", "daily_rest", "weekly_rest", "avg_48h", "expired_licence", "left", "elsewhere", "public_holiday", "not_in_location", "qualification_missing", "ineligible"] as const
const RepeatConflictOut = z.object({
  weekId: z.uuid(), shiftId: z.uuid(), personId: z.string(), date: z.string(), reason: z.enum(CONFLICT_REASONS), open: z.boolean().openapi({ description: "true: the person was taken off and the copy is an OPEN shift; false: the person stays and the line only informs" }), message: z.string(),
})
const RepeatCountsOut = z.object({ copied: z.number().int(), kept: z.number().int(), warned: z.number().int(), opened: z.number().int() }).openapi({ description: "copied = kept + warned + opened: nothing is dropped and nothing is invented" })
const conflictEx = { weekId: WEEK_ID, shiftId: SHIFT_ID, personId: UID, date: "2026-11-10", reason: "approved_leave", open: true, message: "Aoife Byrne is on approved leave (2026-11-10 to 2026-11-12) on 2026-11-10" } as const
const countsEx = { copied: 12, kept: 10, warned: 1, opened: 1 }
export const RepeatBody = z
  .object({ version: z.number().int().min(1), weeks: z.number().openapi({ description: "How many following weeks to create, 1..12 (422 invalid_weeks otherwise)" }), replace: z.boolean().optional().openapi({ description: "Replace an existing DRAFT target week (without it 409 week_exists_draft)" }), targetVersions: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().int().min(1)).optional().openapi({ description: "With `replace`: the version of each target draft the caller saw, by its Monday. A target whose version moved since is 409 version_conflict and nothing is written. A target left out of the map is not checked." }) })
  .openapi({ example: { version: 3, weeks: 2, replace: true, targetVersions: { "2026-11-09": 2 } } })
export const RepeatOut = z
  .object({ created: z.array(WeekOut), conflicts: z.array(RepeatConflictOut), counts: RepeatCountsOut })
  .openapi({ example: { created: [{ ...weekEx, weekStart: "2026-11-09" }], conflicts: [conflictEx], counts: countsEx } })
export type RepeatDto = z.infer<typeof RepeatOut>
export const AutoRepeatBody = z.object({ days: z.number().nullable().openapi({ description: "Days before the next week starts that its draft is created, 1..365; null switches it off (422 invalid_days otherwise)" }) }).openapi({ example: { days: 7 } })
const TemplateOut = z.object({ id: z.uuid(), locationId: z.uuid(), name: z.string(), shifts: z.number().int().openapi({ description: "How many shifts the template holds (the people stay in the template)" }), createdAt: z.string(), createdBy: z.string().nullable() })
const templateEx = { id: "3e8a1d57-9c2b-4f60-8a1e-7b5c3d2f1a09", locationId: LID, name: "Standard week", shifts: 12, createdAt: "2026-11-16T09:00:00.000Z", createdBy: UID }
export const TemplateSchema = TemplateOut.openapi({ example: templateEx })
export type TemplateDto = z.infer<typeof TemplateOut>
export const TemplatesOut = z.object({ items: z.array(TemplateOut) }).openapi({ example: { items: [templateEx] } })
export const TemplatesQuery = z.object({ locationId: z.string().max(64).optional().openapi({ description: "One location (404 when the caller may not see it); omitted: every location the caller sees", example: LID }) })
export const SaveTemplateBody = z.object({ name: z.string().max(200) }).openapi({ example: { name: "Standard week" } })
export const ApplyTemplateBody = z.object({ templateId: z.string().max(64), locationId: z.string().max(64), weekStart: z.string().max(10) }).openapi({ example: { templateId: templateEx.id, locationId: LID, weekStart: "2026-11-23" } })
export const ApplyTemplateOut = z.object({ week: WeekOut, conflicts: z.array(RepeatConflictOut), counts: RepeatCountsOut }).openapi({ example: { week: { ...weekEx, weekStart: "2026-11-23" }, conflicts: [conflictEx], counts: countsEx } })
export type ApplyTemplateDto = z.infer<typeof ApplyTemplateOut>

// ------------------------------------------------------------------ publish, history, confirm (FR-RS-23, 24, 35, 37)

export const PublishBody = z
  .object({ version: z.number().int().min(1), reason: z.string().max(2000).optional(), overrideRuleIds: z.array(z.string().max(40)).max(20).optional() })
  .openapi({ example: { version: 2 } })
export const PublishOut = z.object({ week: WeekOut, violations: z.array(ViolationOut) }).openapi({ example: { week: { ...weekEx, status: "published", publishedAt: "2026-11-16T09:00:00.000Z", publishedBy: UID, version: 3 }, violations: [] } })
const HistoryItem = z.object({
  id: z.uuid(), at: z.string(), actorId: z.string(), action: z.string(), locationId: z.uuid(), weekId: z.uuid().nullable(), shiftId: z.uuid().nullable(), reason: z.string().nullable(),
  before: z.record(z.string(), z.unknown()).nullable(), after: z.record(z.string(), z.unknown()).nullable(),
})
export type HistoryDto = z.infer<typeof HistoryItem>
export const HistoryOut = z
  .object({ items: z.array(HistoryItem), nextCursor: z.string().nullable() })
  .openapi({
    example: {
      items: [{ id: SHIFT_ID, at: "2026-11-16T09:00:00.000Z", actorId: UID, action: "shift_moved", locationId: LID, weekId: WEEK_ID, shiftId: SHIFT_ID, reason: "Cover for sickness", before: { start: "08:00", end: "16:00" }, after: { start: "09:00", end: "17:00" } }],
      nextCursor: "MjAyNi0xMS0xNlQwOTowMDowMC4wMDBafDNmMmI4YzFkLTZhNDctNGUwYi05ZDE1LTJjN2U1YTliNGYxMA",
    },
  })
export const HistoryQuery = z.object({
  limit: z.string().max(5).optional().openapi({ description: "Page size 1..100 (default 50); anything else is 422 invalid_filter", example: "50" }),
  cursor: z.string().max(200).optional().openapi({ description: "The nextCursor of the previous page (newest first, keyset on creation time and id); garbage is 400 invalid_cursor", example: "MjAyNi0xMS0xNlQwOTowMDowMC4wMDBafDNmMmI4YzFkLTZhNDctNGUwYi05ZDE1LTJjN2U1YTliNGYxMA" }),
})

// ------------------------------------------------------------------ change requests (FR-RS-36)

const CR_ID = "4e7a1d93-b2c5-4f08-a6d1-83c9e0f57b12"
/** The patch as it is stored and shown: only the whitelisted shift keys (never a week or a location). */
const ChangePatchOut = z.object({ date: z.string().optional(), start: z.string().optional(), end: z.string().optional(), unpaidBreakMin: z.number().int().optional(), userId: z.string().nullable().optional(), shiftTypeId: z.string().optional(), role: z.string().optional() })
export const ChangeRequestOut = z.object({
  id: z.uuid(), shiftId: z.uuid(), weekId: z.uuid(), locationId: z.uuid(), shiftVersion: z.number().int(), requestedBy: z.string(), patch: ChangePatchOut, reason: z.string(),
  status: z.enum(["requested", "approved", "rejected"]), decidedBy: z.string().nullable(), decidedAt: z.string().nullable(), decisionNote: z.string().nullable(), createdAt: z.string(),
})
export type ChangeRequestDto = z.infer<typeof ChangeRequestOut>
const changeRequestEx = {
  id: CR_ID, shiftId: SHIFT_ID, weekId: WEEK_ID, locationId: LID, shiftVersion: 2, requestedBy: UID, patch: { start: "09:00", end: "17:00" }, reason: "Venue opens late", status: "requested",
  decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-11-16T09:00:00.000Z",
}
export const ChangeRequestSchema = ChangeRequestOut.openapi({ example: changeRequestEx })
export const CreateChangeRequestBody = z
  .object({ patch: z.record(z.string().max(40), z.unknown()), reason: z.string().max(2000).optional() })
  .openapi({ example: { patch: { start: "09:00", end: "17:00" }, reason: "Venue opens late" } })
export const ChangeRequestListOut = z
  .object({ items: z.array(ChangeRequestOut), nextCursor: z.string().nullable() })
  .openapi({ example: { items: [changeRequestEx], nextCursor: "MjAyNi0xMS0xNlQwOTowMDowMC4wMDBafDNmMmI4YzFkLTZhNDctNGUwYi05ZDE1LTJjN2U1YTliNGYxMA" } })
export const ChangeRequestQuery = z.object({
  status: z.string().max(20).optional().openapi({ description: "requested | approved | rejected; anything else is 422 invalid_filter", example: "requested" }),
  locationId: z.string().max(64).optional().openapi({ description: "One location (404 when the caller may not see it)", example: LID }),
  limit: z.string().max(5).optional().openapi({ description: "Page size 1..100 (default 50); anything else is 422 invalid_filter", example: "50" }),
  cursor: z.string().max(200).optional().openapi({ description: "The nextCursor of the previous page (newest first, keyset on creation time and id); garbage is 400 invalid_cursor", example: "MjAyNi0xMS0xNlQwOTowMDowMC4wMDBafDNmMmI4YzFkLTZhNDctNGUwYi05ZDE1LTJjN2U1YTliNGYxMA" }),
})
export const DecideChangeBody = z
  .object({ decision: z.enum(["approve", "reject"]), note: z.string().max(2000).optional(), overrideReason: z.string().max(2000).optional(), overrideRuleIds: z.array(z.string().max(40)).max(20).optional() })
  .openapi({ example: { decision: "approve", note: "Agreed with the client" } })
export const DecideChangeOut = z
  .object({ request: ChangeRequestOut, shift: ShiftOut.nullable(), violations: z.array(ViolationOut) })
  .openapi({ example: { request: { ...changeRequestEx, status: "approved", decidedBy: UID, decidedAt: "2026-11-16T10:00:00.000Z", decisionNote: "Agreed with the client" }, shift: { ...shiftEx, start: "09:00", end: "17:00", version: 3 }, violations: [] } })

// ------------------------------------------------------------------ open shifts, claims and swaps (FR-RS-38, 42, 43; R8-11)

const EX_ID = "6b2d9f41-7c3a-4e85-b0d2-5a8e1f3c9d64"
export const ExchangeOut = z.object({
  id: z.uuid(), kind: z.enum(["claim", "swap"]), shiftId: z.uuid(), weekId: z.uuid(), locationId: z.uuid(), date: z.string(), start: z.string(), end: z.string(),
  fromUserId: z.string(), toUserId: z.string().nullable(), status: z.enum(["requested", "recommended", "approved", "rejected", "cancelled"]), note: z.string(),
  decidedBy: z.string().nullable(), decidedAt: z.string().nullable(), createdAt: z.string(), expired: z.boolean(),
})
export type ExchangeDto = z.infer<typeof ExchangeOut>
const exchangeEx = {
  id: EX_ID, kind: "claim", shiftId: SHIFT_ID, weekId: WEEK_ID, locationId: LID, date: "2026-11-23", start: "08:00", end: "16:00", fromUserId: UID, toUserId: null, status: "requested", note: "",
  decidedBy: null, decidedAt: null, createdAt: "2026-11-16T09:00:00.000Z", expired: false,
}
export const ExchangeSchema = ExchangeOut.openapi({ example: exchangeEx })
export const SwapBody = z
  .object({ toUserId: z.string().min(1).max(128), note: z.string().max(2000).optional() })
  .openapi({ example: { toUserId: "usr_3Hn7vB5cQ9", note: "Dentist appointment" } })
export const ExchangeListOut = z
  .object({ items: z.array(ExchangeOut), nextCursor: z.string().nullable() })
  .openapi({ example: { items: [exchangeEx], nextCursor: "MjAyNi0xMS0xNlQwOTowMDowMC4wMDBafDNmMmI4YzFkLTZhNDctNGUwYi05ZDE1LTJjN2U1YTliNGYxMA" } })
export const ExchangeQuery = z.object({
  status: z.string().max(20).optional().openapi({ description: "requested | recommended | approved | rejected | cancelled; anything else is 422 invalid_filter", example: "requested" }),
  shiftId: z.string().max(64).optional().openapi({ description: "Only the exchanges of one shift (a shift the caller may not see simply has none for them; a non-uuid is 422 invalid_filter)", example: SHIFT_ID }),
  limit: z.string().max(5).optional().openapi({ description: "Page size 1..100 (default 50); anything else is 422 invalid_filter", example: "50" }),
  cursor: z.string().max(200).optional().openapi({ description: "The nextCursor of the previous page (newest first, keyset on creation time and id); garbage is 400 invalid_cursor", example: "MjAyNi0xMS0xNlQwOTowMDowMC4wMDBafDNmMmI4YzFkLTZhNDctNGUwYi05ZDE1LTJjN2U1YTliNGYxMA" }),
})
export const DecideExchangeOut = z
  .object({ exchange: ExchangeOut, shift: ShiftOut.nullable(), violations: z.array(ViolationOut) })
  .openapi({ example: { exchange: { ...exchangeEx, status: "approved", decidedBy: UID, decidedAt: "2026-11-16T10:00:00.000Z" }, shift: { ...shiftEx, version: 2 }, violations: [] } })
export const DecideExchangeBody = z
  .object({ decision: z.enum(["approve", "reject"]), note: z.string().max(2000).optional(), overrideReason: z.string().max(2000).optional(), overrideRuleIds: z.array(z.string().max(40)).max(20).optional() })
  .openapi({ example: { decision: "approve", note: "Covered" } })
