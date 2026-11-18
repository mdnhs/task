import { createHash } from "node:crypto"
import { createRoute, z } from "@hono/zod-openapi"
import { newRouter } from "../../core/router"
import {
  HomeLocationBody, HomeLocationOut, QualificationsBody, QualificationsOut, CreateLocationBody, CreateShiftTypeBody, LocationSchema, LocationsOut, LocationsQuery, OfficeLimitBody, OfficeLimitOut, PatchLocationBody, PatchShiftTypeBody, RosterIdParam, RosterUserParam,
  ShiftTypeSchema, ShiftTypesOut, ShiftTypesQuery, SupervisorsBody, SupervisorsOut, TargetsBody,
} from "./dto"
import { archiveLocation, archiveShiftType, createLocation, createShiftType, getLocation, listLocations, listShiftTypes, patchLocation, patchShiftType, setOfficeLimit, setSupervisors, setTargets } from "./locations"
import { AvailabilityBody, AvailabilityOut, CreateLeaveBody, DecideLeaveBody, LeaveListOut, LeaveQuery, LeaveSchema } from "./dto"
import { CheckOut, RulesBody, RulesHeaders, RulesOut } from "./dto"
import { checkWeek, putRules, readRules, rulesEtag } from "./rules"
import { AddShiftsBody, AddShiftsOut, CreateWeekBody, DeleteShiftQuery, PatchShiftBody, PatchShiftOut, ShiftSchema, WeekSchema, WeeksOut, WeeksQuery } from "./dto"
import { HistoryOut, HistoryQuery, PublishBody, PublishOut } from "./dto"
import { locationHistory, weekHistory } from "./history"
import { confirmShift, publishWeek } from "./publish"
import { addShifts, deleteShift, patchShift } from "./shifts"
import { createWeek, getWeek, listWeeks } from "./weeks"
import { cancelLeave, createLeave, decideLeave, getAvailability, listLeave, putAvailability } from "./leave"
import { setHomeLocation } from "./people"
import { getQualifications, setQualifications } from "./qualifications"
import { ChangeRequestListOut, ChangeRequestQuery, ChangeRequestSchema, CreateChangeRequestBody, DecideChangeBody, DecideChangeOut } from "./dto"
import { createChangeRequest, decideChangeRequest, listChangeRequests } from "./requests"
import { DecideExchangeBody, DecideExchangeOut, ExchangeListOut, ExchangeQuery, ExchangeSchema, SwapBody } from "./dto"
import { cancelExchange, claimShift, declineExchange, decideExchange, listExchanges, recommendExchange, swapShift } from "./exchange"
import { ApplyTemplateBody, ApplyTemplateOut, AutoRepeatBody, RepeatBody, RepeatOut, SaveTemplateBody, TemplateSchema, TemplatesOut, TemplatesQuery } from "./dto"
import { applyTemplate, deleteTemplate, listTemplates, repeatWeek, saveTemplate, setAutoRepeat } from "./repeat"
import { CoverageOut, CoverageQuery, MineOut, MineQuery } from "./dto-reads"
import { ICS_RATE, myIcs, myRoster } from "./mine"
import { coverage } from "./read-model"
import { rateLimit } from "../../core/middleware/rate-limit"
import { subjectUserId } from "../../core/middleware/principal"
import { readModelKey, readModelTtl } from "../read-models/cache"
import { rosterGuard, type RosterCtx } from "./scope"
import { rosterRead, rosterWrite } from "./write"
import { todayOf } from "./qualifications"

const guard = (need: "read" | "write") => rosterGuard(need)
const ETAG_HEADER = { ETag: { description: "Strong ETag of the stored rule settings", schema: { type: "string" as const, example: '"3f2a9c0d1b7e4a58c6d2e9f01a4b7c3d"' } } }
const json = <S extends Parameters<typeof Object>[0]>(schema: S, description: string) => ({ description, content: { "application/json": { schema } } })
const body = <S extends Parameters<typeof Object>[0]>(schema: S) => ({ content: { "application/json": { schema } }, required: true as const })

/** The part of a roster read-model cache key that names what the caller may see: the scope and the exact set of sites (hashed), so two callers with different cuts never share an entry. */
const scopeKey = (ctx: RosterCtx): string => `rs=${ctx.access.scope}:${createHash("sha1").update([...(ctx.access.locationIds ?? [])].sort().join(",")).digest("hex").slice(0, 16)}`

const HIDDEN = "404 not_found for a location the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer)"

const listR = createRoute({
  method: "get", path: "/v1/locations", middleware: guard("read"), request: { query: LocationsQuery },
  responses: { 200: json(LocationsOut, "The locations the caller may see (a supervisor: only the granted ones; an office role with an except list: all but those; staff: none). Archived ones only with includeArchived=true") },
})
const createR = createRoute({
  method: "post", path: "/v1/locations", middleware: guard("write"), request: { body: body(CreateLocationBody) },
  responses: { 201: json(LocationSchema, "The new location (office roster roles only: 403 forbidden). 409 location_name_taken; 422 invalid_location | invalid_coordinates | invalid_zone_radius (0..5000 m) | invalid_time_zone (not an IANA zone)") },
})
const getR = createRoute({
  method: "get", path: "/v1/locations/{id}", middleware: guard("read"), request: { params: RosterIdParam },
  responses: { 200: json(LocationSchema, `One location with its active supervisor ids. ${HIDDEN}`) },
})
const patchR = createRoute({
  method: "patch", path: "/v1/locations/{id}", middleware: guard("write"), request: { params: RosterIdParam, body: body(PatchLocationBody) },
  responses: { 200: json(LocationSchema, `The updated location (office only). A changed time zone recomputes DRAFT shifts only. ${HIDDEN}; 409 version_conflict | location_name_taken | location_archived; 422 as POST`) },
})
const archiveR = createRoute({
  method: "post", path: "/v1/locations/{id}/archive", middleware: guard("write"), request: { params: RosterIdParam },
  responses: { 200: json(LocationSchema, `The location is archived, never deleted (office only; repeat is a 200). ${HIDDEN}`) },
})
const supervisorsR = createRoute({
  method: "put", path: "/v1/locations/{id}/supervisors", middleware: guard("write"), request: { params: RosterIdParam, body: body(SupervisorsBody) },
  responses: { 200: json(SupervisorsOut, `The supervisor set of the location, replaced (office only). An unchanged set writes nothing. ${HIDDEN}; 409 location_archived; 422 invalid_supervisor (not an active member)`) },
})
const typesR = createRoute({
  method: "get", path: "/v1/locations/{id}/shift-types", middleware: guard("read"), request: { params: RosterIdParam, query: ShiftTypesQuery },
  responses: { 200: json(ShiftTypesOut, `The shift types of the location with their weekday targets. ${HIDDEN}`) },
})
const createTypeR = createRoute({
  method: "post", path: "/v1/locations/{id}/shift-types", middleware: guard("write"), request: { params: RosterIdParam, body: body(CreateShiftTypeBody) },
  responses: { 201: json(ShiftTypeSchema, `The new shift type (office only). end before start is overnight; start equal to end is refused. ${HIDDEN}; 409 shift_type_name_taken | location_archived; 422 invalid_shift_type`) },
})
const patchTypeR = createRoute({
  method: "patch", path: "/v1/shift-types/{id}", middleware: guard("write"), request: { params: RosterIdParam, body: body(PatchShiftTypeBody) },
  responses: { 200: json(ShiftTypeSchema, `The updated shift type (office only; shifts already rostered keep their copy). ${HIDDEN}; 409 version_conflict | shift_type_name_taken | shift_type_archived; 422 invalid_shift_type`) },
})
const deleteTypeR = createRoute({
  method: "delete", path: "/v1/shift-types/{id}", middleware: guard("write"), request: { params: RosterIdParam },
  responses: { 204: { description: `The shift type is archived (never deleted, always succeeds, repeat included); shifts that use it keep reading it. ${HIDDEN}` } },
})
const targetsR = createRoute({
  method: "put", path: "/v1/shift-types/{id}/targets", middleware: guard("write"), request: { params: RosterIdParam, body: body(TargetsBody) },
  responses: { 200: json(ShiftTypeSchema, `The staffing target per weekday (0 = Sunday ... 6, count 0..99), replacing the whole set (office only). ${HIDDEN}; 409 shift_type_archived; 422 invalid_targets`) },
})
const limitR = createRoute({
  method: "put", path: "/v1/roster/office-limits/{userId}", middleware: guard("write"), request: { params: RosterUserParam, body: body(OfficeLimitBody) },
  responses: { 200: json(OfficeLimitOut, "The sites a Roster Manager does NOT manage (an office role with no limit of its own only: 403 forbidden). 404 member_not_found; 422 not_roster_office (not an active member with office level and roster write) | invalid_location") },
})

const qualsR = createRoute({
  method: "get", path: "/v1/members/{userId}/qualifications", middleware: guard("read"), request: { params: RosterUserParam },
  responses: { 200: json(QualificationsOut, "The person's qualifications with `expired` computed on the clock (valid through the expiry date). Read: the person, an office role, a supervisor of a location the person is homed or rostered at. 404 member_not_found for a person who does not exist, is of another tenant or out of the caller's reach") },
})
const putQualsR = createRoute({
  method: "put", path: "/v1/members/{userId}/qualifications", middleware: guard("write"), request: { params: RosterUserParam, body: body(QualificationsBody) },
  responses: { 200: json(QualificationsOut, "The person's whole set of qualifications, replaced (office only: 403 forbidden). Types are free-text keys, trimmed and unique (max 50); an unchanged set writes nothing. 404 member_not_found; 422 invalid_qualification") },
})
const homeR = createRoute({
  method: "put", path: "/v1/members/{userId}/home-location", middleware: guard("write"), request: { params: RosterUserParam, body: body(HomeLocationBody) },
  responses: { 200: json(HomeLocationOut, "The person's home location (null clears it; office only). 404 member_not_found | not_found (a location the caller may not see, missing, another tenant's or not a uuid: one answer); 409 location_archived") },
})

const LEAVE_HIDDEN = "404 leave_not_found for a leave the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer)"
const leaveListR = createRoute({
  method: "get", path: "/v1/leave", middleware: guard("read"), request: { query: LeaveQuery },
  responses: { 200: json(LeaveListOut, "The caller's own leave, plus (supervisor) people homed at their sites or (office) people within scope: homed at a site the role manages or nowhere. A read-only manager and staff see their own only. 422 invalid_filter.") },
})
const leaveCreateR = createRoute({
  method: "post", path: "/v1/leave", middleware: guard("read"), request: { body: body(CreateLeaveBody) },
  responses: { 201: json(LeaveSchema, "The caller's own request (status requested); the approvers are told. 409 leave_overlap (own open or approved leave); 422 invalid_leave (real dates, to not before from, at most a year, kind 1..40, note up to 500).") },
})
const leaveCancelR = createRoute({
  method: "post", path: "/v1/leave/{id}/cancel", middleware: guard("read"), request: { params: RosterIdParam },
  responses: { 200: json(LeaveSchema, `The requester withdraws an open or approved request. Someone who can see it but did not ask: 403 forbidden. 409 leave_not_open. ${LEAVE_HIDDEN}`) },
})
const leaveDecideR = createRoute({
  method: "post", path: "/v1/leave/{id}/decide", middleware: guard("write"), request: { params: RosterIdParam, body: body(DecideLeaveBody) },
  responses: { 200: json(LeaveSchema, `Approve or reject an open request (D8): the supervisor of the person's home site, else an office role whose scope covers it; never the requester (403 self_decision). 409 already_decided. ${LEAVE_HIDDEN}`) },
})
const availGetR = createRoute({
  method: "get", path: "/v1/roster/availability", middleware: guard("read"),
  responses: { 200: json(AvailabilityOut, "The caller's own \"not available\" windows per weekday (0 = Sunday ... 6); an overnight window is its two stored rows, split at midnight.") },
})
const availPutR = createRoute({
  method: "put", path: "/v1/roster/availability", middleware: guard("read"), request: { body: body(AvailabilityBody) },
  responses: { 200: json(AvailabilityOut, "The caller's whole set, replaced atomically. A window with `to` before `from` crosses midnight and is stored as two rows; to 00:00 means 24:00. 422 invalid_availability (weekday 0..6, HH:MM, from not equal to to, at most 50 rows).") },
})

const rulesGetR = createRoute({
  method: "get", path: "/v1/roster/rules", middleware: guard("read"),
  responses: { 200: { ...json(RulesOut, "The tenant's rule severities (block | warn per rule; ignore only for the non-statutory rules) and the averaging window in weeks. Anyone with roster read; defaults until an admin changes them. The strong ETag header is what PUT sends back as If-Match."), headers: ETAG_HEADER } },
})
const rulesPutR = createRoute({
  method: "put", path: "/v1/roster/rules", middleware: guard("write"), request: { body: body(RulesBody), headers: RulesHeaders },
  responses: { 200: { ...json(RulesOut, "The settings after the change, PATCH-like: a rule or the window left out keeps its stored value (admin or owner: 403 forbidden otherwise; audit roster.rules_changed; an unchanged set writes nothing). ignore is refused for daily_rest, weekly_rest and avg_48h. 422 invalid_rules (unknown rule id or severity) | invalid_avg_weeks (1..52). 428 precondition_required (no If-Match), 412 precondition_failed (stale; the current ETag in the ETag header). The new ETag is in the ETag header."), headers: ETAG_HEADER } },
})
const checkR = createRoute({
  method: "post", path: "/v1/roster/weeks/{id}/check", middleware: guard("write"), request: { params: RosterIdParam },
  responses: { 200: json(CheckOut, "A dry run: the rule violations on the people's shifts of that week, with the tenant's severities. A clash with a shift at a site the caller cannot see reads \"Already rostered elsewhere\" (no site, time or shift id) and leave, availability and hour totals carry no detail. Writes nothing. 404 not_found for a week of a site the caller may not see, a missing or another tenant's week and an id that is not a uuid.") },
})

const WEEK_HIDDEN = "404 not_found for a week or shift of a site the caller may not see, a missing or another tenant's one and an id that is not a uuid (all the same answer)"
const weeksR = createRoute({
  method: "get", path: "/v1/roster/weeks", middleware: guard("read"), request: { query: WeeksQuery },
  responses: { 200: json(WeeksOut, "The weeks of the range with their 7 day columns (count against target, short and over), shifts with each person's own start and end, the shift types with targets of their locations, and the members the caller may pick from (a supervisor gets no home location). Only locations the caller sees; staff get an empty cut. 404 not_found for a location the caller may not see; 422 invalid_view | invalid_range") },
})
const weekCreateR = createRoute({
  method: "post", path: "/v1/roster/weeks", middleware: guard("write"), request: { body: body(CreateWeekBody) },
  responses: { 201: json(WeekSchema, "An empty draft week (a supervisor of the site or an office role). 404 not_found for a site the caller may not see; 409 week_exists (the existing id is in `weekId`) | location_archived; 422 invalid_week_start (a real Monday).") },
})
const weekGetR = createRoute({
  method: "get", path: "/v1/roster/weeks/{id}", middleware: guard("read"), request: { params: RosterIdParam },
  responses: { 200: json(WeeksOut, `One week in the same payload as the list. ${WEEK_HIDDEN}`) },
})
const shiftsAddR = createRoute({
  method: "post", path: "/v1/roster/weeks/{id}/shifts", middleware: guard("write"), request: { params: RosterIdParam, body: body(AddShiftsBody) },
  responses: { 201: json(AddShiftsOut, `Assigns several people at once, all or nothing (null = an open shift; start, end, break and role default from the shift type and may differ per entry; an end at or before the start runs into the next day). Rule warnings (and, for an office role with a reason, overridden blocks) come back in violations. ${WEEK_HIDDEN}; 403 roster_locked (a supervisor on a published week); 409 shift_exists | shift_conflict (the database refused the pair) | location_archived; 422 invalid_shift | invalid_shift_type | ineligible (left, qualification missing or expired; generic ineligible for a person of a site the caller cannot see) | rule_blocked (on a PUBLISHED week an office role must also name the overridden rules in overrideRuleIds, 422 invalid_override for an unknown id) | reason_required (office on a published week)`) },
})
const shiftPatchR = createRoute({
  method: "patch", path: "/v1/roster/shifts/{id}", middleware: guard("write"), request: { params: RosterIdParam, body: body(PatchShiftBody) },
  responses: { 200: json(PatchShiftOut, `Moves, retimes, reassigns or retypes one shift inside its week (patch keys: date, start, end, unpaidBreakMin, userId, shiftTypeId, role). ${WEEK_HIDDEN}; 403 roster_locked (a supervisor on a published week); 409 version_conflict | shift_exists | shift_conflict | location_archived; 422 cannot_move_week | invalid_patch | invalid_shift | ineligible | rule_blocked (overrideRuleIds on a published week, as for add) | invalid_override | reason_required`) },
})
const publishR = createRoute({
  method: "post", path: "/v1/roster/weeks/{id}/publish", middleware: guard("write"), request: { params: RosterIdParam, body: body(PublishBody) },
  responses: { 200: json(PublishOut, `Publishes the draft week (no unpublish): the week locks for supervisors, every rostered person is told once, \`roster.week_published\` is published once. Warnings never stop it and come back in violations; a block needs an office role with a reason (overrideRuleIds may name the overridden rules). ${WEEK_HIDDEN}; 403 rule_blocked_office_required (a supervisor over a block); 409 already_published | version_conflict | location_archived; 422 rule_blocked | invalid_override | invalid_reason`) },
})
const confirmR = createRoute({
  method: "post", path: "/v1/roster/shifts/{id}/confirm", middleware: guard("read"), request: { params: RosterIdParam },
  responses: { 200: json(ShiftSchema, `The assigned person confirms their shift on a published week (repeat is a 200 and writes nothing). Someone else who can see the shift: 403 forbidden. ${WEEK_HIDDEN}; 409 week_not_published`) },
})
const weekHistoryR = createRoute({
  method: "get", path: "/v1/roster/weeks/{id}/history", middleware: guard("read"), request: { params: RosterIdParam, query: HistoryQuery },
  responses: { 200: json(HistoryOut, `The week's change lines, newest first, with who, when, before, after and the reason (ids only, never a name; a site id the caller cannot see is masked). ${WEEK_HIDDEN}; 400 invalid_cursor; 422 invalid_filter`) },
})
const locationHistoryR = createRoute({
  method: "get", path: "/v1/locations/{id}/history", middleware: guard("read"), request: { params: RosterIdParam, query: HistoryQuery },
  responses: { 200: json(HistoryOut, `Every roster line of the site, newest first. ${HIDDEN}; 400 invalid_cursor; 422 invalid_filter`) },
})
const shiftDeleteR = createRoute({
  method: "delete", path: "/v1/roster/shifts/{id}", middleware: guard("write"), request: { params: RosterIdParam, query: DeleteShiftQuery },
  responses: { 204: { description: `The shift is removed; history keeps it whole. ${WEEK_HIDDEN}; 403 roster_locked (a supervisor on a published week); 409 version_conflict (a stale ?version=); 422 reason_required (office on a published week)` } },
})
const CR_HIDDEN = "404 change_request_not_found for a request of a site the caller may not see, a missing or another tenant's one and an id that is not a uuid (all the same answer)"
const changeCreateR = createRoute({
  method: "post", path: "/v1/roster/shifts/{id}/change-requests", middleware: guard("write"), request: { params: RosterIdParam, body: body(CreateChangeRequestBody) },
  responses: { 201: json(ChangeRequestSchema, `A request for a change to a shift of a PUBLISHED week (a supervisor of the site or an office role); the patch takes the same keys as a shift edit, never a week. Office is told. ${WEEK_HIDDEN}; 409 use_direct_edit (the week is a draft: edit it) | location_archived | request_open (the shift already has an open request); 422 reason_required (missing or blank) | invalid_patch | cannot_move_week | invalid_shift | invalid_shift_type | invalid_reason`) },
})
const changeListR = createRoute({
  method: "get", path: "/v1/roster/change-requests", middleware: guard("read"), request: { query: ChangeRequestQuery },
  responses: { 200: json(ChangeRequestListOut, "The change requests of the sites the caller sees, newest first (a supervisor: their own sites; staff: an empty list). 404 not_found for a location the caller may not see; 400 invalid_cursor; 422 invalid_filter") },
})
const changeDecideR = createRoute({
  method: "post", path: "/v1/roster/change-requests/{id}/decide", middleware: guard("write"), request: { params: RosterIdParam, body: body(DecideChangeBody) },
  responses: { 200: json(DecideChangeOut, `Approve (the patch is applied as an office edit: rules and eligibility run again, the person confirms again) or reject (office roles only: 403 forbidden for anyone else who can see it). ${CR_HIDDEN}; 403 self_decision (your own request, or a change to your own shift); 409 already_decided | stale_request (the shift changed since the request; it stays open) | location_archived | version_conflict; 422 rule_blocked (a new block: overrideReason and overrideRuleIds needed) | ineligible | invalid_override | invalid_reason | invalid_decision | invalid_patch | invalid_shift | cannot_move_week | shift_exists`) },
})

const EX_HIDDEN = "404 exchange_not_found for an exchange of a site the caller may not see, a missing or another tenant's one and an id that is not a uuid (all the same answer)"
const claimR = createRoute({
  method: "post", path: "/v1/roster/shifts/{id}/claim", middleware: guard("read"), request: { params: RosterIdParam },
  responses: {
    201: json(ExchangeSchema, `The caller asks for an OPEN shift of a published, upcoming week at a site they are located at (homed there or rostered there that week); approvers are told. The same open claim again is the same exchange with 200. ${WEEK_HIDDEN} (also for a shift of a site the caller is not located at); 409 week_not_published (office roles; a member with no edit role gets the plain 404 for a draft week) | shift_not_open | shift_started | location_archived | too_many_open (5 open exchanges per person); 422 ineligible (left, a required qualification missing or expired)`),
    200: json(ExchangeSchema, "The caller's own open claim of this shift, returned as it is (a double click)"),
  },
})
const swapR = createRoute({
  method: "post", path: "/v1/roster/shifts/{id}/swap", middleware: guard("read"), request: { params: RosterIdParam, body: body(SwapBody) },
  responses: {
    201: json(ExchangeSchema, `The person on the shift hands it over to a named colleague (homed at the shift's site, rostered there that week, or within the caller's scope); the colleague and the approvers are told. Someone else who can see the shift: 403 forbidden. ${WEEK_HIDDEN}; 404 member_not_found (the colleague does not exist, is another tenant's or of a site the caller does not know: one answer); 404 not_found also for a member with no edit role on a DRAFT week; 409 exchange_open (another open swap of the shift) | shift_started | location_archived | too_many_open | cooldown (the same colleague again within an hour of a cancel or a refusal); 422 invalid_swap (yourself) | invalid_note | ineligible (generic for a person the caller may not know)`),
    200: json(ExchangeSchema, "The same open swap to the same colleague, returned as it is (a double click)"),
  },
})
const exchangesR = createRoute({
  method: "get", path: "/v1/roster/exchanges", middleware: guard("read"), request: { query: ExchangeQuery },
  responses: { 200: json(ExchangeListOut, "The exchanges the caller is a party to plus those of the sites they see (a supervisor: their own; office: in scope), newest first. `expired` is true for an open one whose shift has started. 400 invalid_cursor; 422 invalid_filter") },
})
const recommendR = createRoute({
  method: "post", path: "/v1/roster/exchanges/{id}/recommend", middleware: guard("write"), request: { params: RosterIdParam },
  responses: { 200: json(ExchangeSchema, `A supervisor (or office) passes an open exchange of a PUBLISHED week to the office: requested becomes recommended (a repeat is a 200 and writes nothing). ${EX_HIDDEN}; 403 forbidden (a role that edits nothing) | self_decision (a party to it); 409 already_decided | week_not_published (a draft week is decided directly) | exchange_expired`) },
})
const decideR = createRoute({
  method: "post", path: "/v1/roster/exchanges/{id}/decide", middleware: guard("write"), request: { params: RosterIdParam, body: body(DecideExchangeBody) },
  responses: { 200: json(DecideExchangeOut, `Approve (the shift changes hands, rules and eligibility run again, the new person confirms) or reject. Who: a supervisor or office on a draft week; on a published week office only, unless the location delegates swap approval (then its supervisor too); staff never. ${EX_HIDDEN}; 403 forbidden (a role that edits nothing) | roster_locked (a supervisor on a published week without delegation) | self_decision (a party to it or the person on the shift); 409 already_decided | exchange_expired | shift_taken (a claim whose shift was assigned meanwhile) | shift_changed (a swap whose shift changed hands) | location_archived | version_conflict | shift_exists; 422 rule_blocked (a block: office needs overrideReason and, on a published week, overrideRuleIds) | ineligible | invalid_override | invalid_reason | invalid_decision`) },
})
const declineR = createRoute({
  method: "post", path: "/v1/roster/exchanges/{id}/decline", middleware: guard("read"), request: { params: RosterIdParam },
  responses: { 200: json(ExchangeSchema, `The colleague a swap is offered to refuses it: the exchange is rejected and the requester is told. Anyone else who can see it (the requester cancels instead): 403 forbidden. ${EX_HIDDEN}; 409 already_decided`) },
})
const cancelR = createRoute({
  method: "post", path: "/v1/roster/exchanges/{id}/cancel", middleware: guard("read"), request: { params: RosterIdParam },
  responses: { 200: json(ExchangeSchema, `The requester withdraws their own open exchange (also after the shift started). Someone who can see it but did not ask: 403 forbidden. ${EX_HIDDEN}; 409 already_decided`) },
})

const repeatR = createRoute({
  method: "post", path: "/v1/roster/weeks/{id}/repeat", middleware: guard("write"), request: { params: RosterIdParam, body: body(RepeatBody) },
  responses: { 201: json(RepeatOut, `Copies the week's people and individual times to the next 1..12 weeks as DRAFTS (a supervisor of the site too: the copies are drafts, the publish lock is not touched), all or nothing. Every copied shift is re-checked: a block (approved leave, a clash anywhere, a person who left or lacks a qualification) makes it an OPEN shift with a conflict row (open true), a warning or a public holiday keeps the person with a line (open false); copied = kept + warned + opened. Nobody is notified. ${WEEK_HIDDEN}; 403 forbidden (a role that edits nothing); 409 version_conflict (the source version, or a targetVersions entry of a draft being replaced, is stale) | week_published (a target is published) | week_exists_draft (a target is a draft and replace is not true) | location_archived; 422 invalid_weeks`) },
})
const autoRepeatR = createRoute({
  method: "put", path: "/v1/roster/weeks/{id}/auto-repeat", middleware: guard("write"), request: { params: RosterIdParam, body: body(AutoRepeatBody) },
  responses: { 200: json(WeekSchema, `Sets how many days before the next week starts the worker creates its draft from this PUBLISHED week and tells the location's supervisors (null: off). A scheduling setting, not a roster edit: a supervisor of the site may set it on a published week; the version does not move; an unchanged value writes nothing. ${WEEK_HIDDEN}; 403 forbidden; 409 location_archived; 422 invalid_days (1..365)`) },
})
const saveTemplateR = createRoute({
  method: "post", path: "/v1/roster/weeks/{id}/save-template", middleware: guard("write"), request: { params: RosterIdParam, body: body(SaveTemplateBody) },
  responses: { 201: json(TemplateSchema, `A named copy of the week's people and times by weekday (a draft or a published week; the week is untouched). ${WEEK_HIDDEN}; 403 forbidden; 409 template_name_taken | template_limit (50 per location); 422 invalid_template (blank or over 80 characters)`) },
})
const templatesR = createRoute({
  method: "get", path: "/v1/roster/week-templates", middleware: guard("read"), request: { query: TemplatesQuery },
  responses: { 200: json(TemplatesOut, "The saved week templates of the locations the caller sees (a supervisor: their own sites; staff: none), by name. Counts only, never the people. 404 not_found for a location the caller may not see") },
})
const deleteTemplateR = createRoute({
  method: "delete", path: "/v1/roster/week-templates/{id}", middleware: guard("write"), request: { params: RosterIdParam },
  responses: { 204: { description: `The template is deleted (office roles only: 403 forbidden for a supervisor who can see it). ${HIDDEN}` } },
})
const applyTemplateR = createRoute({
  method: "post", path: "/v1/roster/week-templates/apply", middleware: guard("write"), request: { body: body(ApplyTemplateBody) },
  responses: { 201: json(ApplyTemplateOut, `A new DRAFT week at a location from a template (an empty draft week is filled). At another location the shift types are matched by name and people who are not on that site's team become open shifts with a conflict; leave, a clash, a person who left or lacks a qualification are opened as in a repeat. Nobody is notified. ${HIDDEN} (for the template and for the location); 403 forbidden; 409 week_exists (the existing week with shifts, its id in weekId) | week_published | location_archived; 422 invalid_week_start (a real Monday) | no_matching_type (typeNames lists them)`) },
})

const mineR = createRoute({
  method: "get", path: "/v1/roster/mine", middleware: guard("read"), request: { query: MineQuery },
  responses: { 200: json(MineOut, "The caller's OWN shifts of PUBLISHED weeks across every location as one list (FR-RS-33), by start date: the place's name and address, the times (wall strings and instants), the confirmation state. Never another person, never a draft week. An API key reads its creator's. `from` defaults to today (tenant zone), `to` to 27 days later (at most 366 days). 422 invalid_range") },
})
const mineIcsR = createRoute({
  method: "get", path: "/v1/roster/mine.ics", middleware: [...guard("read"), rateLimit("roster-ics", ICS_RATE, (c) => `${c.get("tenant")!.id}:${subjectUserId(c)}`)] as const, request: { query: MineQuery },
  responses: {
    200: { description: "The same shifts as an iCalendar download (R8-16, FR-RS-40): `text/calendar; charset=utf-8`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`. UTC times from the stored instants (no VTIMEZONE), UID `<shift uuid>@<host of APP_URL>`, CRLF lines folded at 75 octets, every text escaped. Summary: role at place; location: name and address; nothing about another person. Needs the caller's own session (or API key): there is no secret URL. 20 downloads a minute per person (429 rate_limited with Retry-After). 422 invalid_range (a problem document, not a calendar)", content: { "text/calendar": { schema: z.string().openapi({ example: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n" }) } } },
  },
})
const coverageR = createRoute({
  method: "get", path: "/v1/roster/coverage", middleware: guard("read"), request: { query: CoverageQuery },
  responses: { 200: json(CoverageOut, "Per location the caller sees and per day of the range: people assigned (`staff`), the staffing target, `short` and `over` (the domain day columns: an open shift is not a person, so it counts as short) and the open shifts, for draft and published weeks. A supervisor: their sites; an office role: all but its except list; staff: an empty list. Derived on read (cached 30 s per scope, dropped by any write). 404 not_found for a location the caller may not see, a missing one and a non-uuid id; 422 invalid_range (at most 62 days)") },
})

export const rosterRoutes = newRouter()
  .openapi(listR, async (c) => c.json(await rosterRead(c, (tx, ctx) => listLocations(tx, ctx, { includeArchived: c.req.valid("query").includeArchived === "true" })), 200))
  .openapi(createR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => createLocation(tx, ctx, c.req.valid("json"))), 201))
  .openapi(getR, async (c) => c.json(await rosterRead(c, (tx, ctx) => getLocation(tx, ctx, c.req.valid("param").id)), 200))
  .openapi(patchR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => patchLocation(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(archiveR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => archiveLocation(tx, ctx, c.req.valid("param").id)), 200))
  .openapi(supervisorsR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => setSupervisors(tx, ctx, env, c.req.valid("param").id, c.req.valid("json").userIds)), 200))
  .openapi(typesR, async (c) => c.json(await rosterRead(c, (tx, ctx) => listShiftTypes(tx, ctx, c.req.valid("param").id, { includeArchived: c.req.valid("query").includeArchived === "true" })), 200))
  .openapi(createTypeR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => createShiftType(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 201))
  .openapi(patchTypeR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => patchShiftType(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(deleteTypeR, async (c) => {
    await rosterWrite(c, (tx, ctx) => archiveShiftType(tx, ctx, c.req.valid("param").id))
    return c.body(null, 204)
  })
  .openapi(targetsR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => setTargets(tx, ctx, c.req.valid("param").id, c.req.valid("json").targets)), 200))
  .openapi(qualsR, async (c) => c.json(await rosterRead(c, (tx, ctx) => getQualifications(tx, ctx, c.req.valid("param").userId)), 200))
  .openapi(putQualsR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => setQualifications(tx, ctx, c.req.valid("param").userId, c.req.valid("json").qualifications)), 200))
  .openapi(homeR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => setHomeLocation(tx, ctx, c.req.valid("param").userId, c.req.valid("json").locationId)), 200))
  .openapi(limitR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => setOfficeLimit(tx, ctx, env, c.req.valid("param").userId, c.req.valid("json").except)), 200))
  .openapi(leaveListR, async (c) => c.json(await rosterRead(c, (tx, ctx) => listLeave(tx, ctx, c.req.valid("query"))), 200))
  .openapi(leaveCreateR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => createLeave(tx, ctx, env, c.req.valid("json")), "self"), 201))
  .openapi(leaveCancelR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => cancelLeave(tx, ctx, env, c.req.valid("param").id), "self"), 200))
  .openapi(leaveDecideR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => decideLeave(tx, ctx, env, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(availGetR, async (c) => c.json(await rosterRead(c, (tx, ctx) => getAvailability(tx, ctx)), 200))
  .openapi(availPutR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => putAvailability(tx, ctx, c.req.valid("json").windows), "self"), 200))
  .openapi(rulesGetR, async (c) => {
    const rules = await rosterRead(c, (tx, ctx) => readRules(tx, ctx.tenantId))
    c.header("ETag", rulesEtag(rules))
    return c.json(rules, 200)
  })
  .openapi(rulesPutR, async (c) => {
    const ifMatch = c.req.header("if-match")?.trim()
    const rules = await rosterWrite(c, (tx, ctx) => putRules(tx, ctx, c.req.valid("json"), ifMatch))
    c.header("ETag", rulesEtag(rules))
    return c.json(rules, 200)
  })
  .openapi(checkR, async (c) =>
    c.json(
      await rosterRead(c, async (tx, ctx) => {
        const violations = await checkWeek(tx, ctx, c.req.valid("param").id)
        return { weekId: c.req.valid("param").id, violations, blocking: violations.filter((v) => v.severity === "block").length }
      }),
      200,
    ),
  )
  .openapi(weeksR, async (c) => c.json(await rosterRead(c, (tx, ctx) => listWeeks(tx, ctx, c.req.valid("query"))), 200))
  .openapi(weekCreateR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => createWeek(tx, ctx, c.req.valid("json"))), 201))
  .openapi(weekGetR, async (c) => c.json(await rosterRead(c, (tx, ctx) => getWeek(tx, ctx, c.req.valid("param").id)), 200))
  .openapi(shiftsAddR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => addShifts(tx, ctx, env, c.req.valid("param").id, c.req.valid("json"))), 201))
  .openapi(shiftPatchR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => patchShift(tx, ctx, env, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(publishR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => publishWeek(tx, ctx, env, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(confirmR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => confirmShift(tx, ctx, env, c.req.valid("param").id), "self"), 200))
  .openapi(weekHistoryR, async (c) => c.json(await rosterRead(c, (tx, ctx) => weekHistory(tx, ctx, c.req.valid("param").id, c.req.valid("query"))), 200))
  .openapi(locationHistoryR, async (c) => c.json(await rosterRead(c, (tx, ctx) => locationHistory(tx, ctx, c.req.valid("param").id, c.req.valid("query"))), 200))
  .openapi(changeCreateR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => createChangeRequest(tx, ctx, env, c.req.valid("param").id, c.req.valid("json"))), 201))
  .openapi(changeListR, async (c) => c.json(await rosterRead(c, (tx, ctx) => listChangeRequests(tx, ctx, c.req.valid("query"))), 200))
  .openapi(changeDecideR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => decideChangeRequest(tx, ctx, env, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(claimR, async (c) => {
    const out = await rosterWrite(c, (tx, ctx, env) => claimShift(tx, ctx, env, c.req.valid("param").id), "self")
    return out.created ? c.json(out.exchange, 201) : c.json(out.exchange, 200)
  })
  .openapi(swapR, async (c) => {
    const out = await rosterWrite(c, (tx, ctx, env) => swapShift(tx, ctx, env, c.req.valid("param").id, c.req.valid("json")), "self")
    return out.created ? c.json(out.exchange, 201) : c.json(out.exchange, 200)
  })
  .openapi(exchangesR, async (c) => c.json(await rosterRead(c, (tx, ctx) => listExchanges(tx, ctx, c.req.valid("query"))), 200))
  .openapi(recommendR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => recommendExchange(tx, ctx, env, c.req.valid("param").id)), 200))
  .openapi(decideR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => decideExchange(tx, ctx, env, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(declineR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => declineExchange(tx, ctx, env, c.req.valid("param").id), "self"), 200))
  .openapi(cancelR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => cancelExchange(tx, ctx, c.req.valid("param").id), "self"), 200))
  .openapi(repeatR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => repeatWeek(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 201))
  .openapi(autoRepeatR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => setAutoRepeat(tx, ctx, c.req.valid("param").id, c.req.valid("json").days)), 200))
  .openapi(saveTemplateR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => saveTemplate(tx, ctx, c.req.valid("param").id, c.req.valid("json").name)), 201))
  .openapi(templatesR, async (c) => c.json(await rosterRead(c, (tx, ctx) => listTemplates(tx, ctx, c.req.valid("query"))), 200))
  .openapi(applyTemplateR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => applyTemplate(tx, ctx, c.req.valid("json"))), 201))
  .openapi(deleteTemplateR, async (c) => {
    await rosterWrite(c, (tx, ctx) => deleteTemplate(tx, ctx, c.req.valid("param").id))
    return c.body(null, 204)
  })
  .openapi(mineR, async (c) => c.json(await rosterRead(c, (tx, ctx) => myRoster(tx, ctx, c.req.valid("query"))), 200))
  .openapi(mineIcsR, async (c) => {
    const text = await rosterRead(c, (tx, ctx) => myIcs(tx, ctx, c.req.valid("query"), new URL(c.get("deps").env.APP_URL).hostname))
    return c.body(text, 200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="roster.ics"', "x-content-type-options": "nosniff", "cache-control": "private, no-store" })
  })
  .openapi(coverageR, async (c) => {
    const q = c.req.valid("query")
    const out = await rosterRead(c, (tx, ctx) => {
      const deps = c.get("deps")
      const key = readModelKey(c, `coverage:${createHash("sha1").update(JSON.stringify([q.from ?? null, q.to ?? null, q.locationId ?? null])).digest("hex").slice(0, 16)}`, scopeKey(ctx), false, todayOf(ctx))
      return deps.readModelCache.cached(key, readModelTtl(!!c.get("support")), () => coverage(tx, ctx, q), ctx.now)
    })
    return c.json(out, 200)
  })
  .openapi(shiftDeleteR, async (c) => {
    await rosterWrite(c, (tx, ctx, env) => deleteShift(tx, ctx, env, c.req.valid("param").id, c.req.valid("query")))
    return c.body(null, 204)
  })
