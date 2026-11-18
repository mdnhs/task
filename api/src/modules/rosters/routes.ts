import { createRoute } from "@hono/zod-openapi"
import { newRouter } from "../../core/router"
import {
  HomeLocationBody, HomeLocationOut, QualificationsBody, QualificationsOut, CreateLocationBody, CreateShiftTypeBody, LocationSchema, LocationsOut, LocationsQuery, OfficeLimitBody, OfficeLimitOut, PatchLocationBody, PatchShiftTypeBody, RosterIdParam, RosterUserParam,
  ShiftTypeSchema, ShiftTypesOut, ShiftTypesQuery, SupervisorsBody, SupervisorsOut, TargetsBody,
} from "./dto"
import { archiveLocation, archiveShiftType, createLocation, createShiftType, getLocation, listLocations, listShiftTypes, patchLocation, patchShiftType, setOfficeLimit, setSupervisors, setTargets } from "./locations"
import { AvailabilityBody, AvailabilityOut, CreateLeaveBody, DecideLeaveBody, LeaveListOut, LeaveQuery, LeaveSchema } from "./dto"
import { CheckOut, RulesBody, RulesOut } from "./dto"
import { checkWeek, putRules, readRules } from "./rules"
import { cancelLeave, createLeave, decideLeave, getAvailability, listLeave, putAvailability } from "./leave"
import { setHomeLocation } from "./people"
import { getQualifications, setQualifications } from "./qualifications"
import { rosterGuard } from "./scope"
import { rosterRead, rosterWrite } from "./write"

const guard = (need: "read" | "write") => rosterGuard(need)
const json = <S extends Parameters<typeof Object>[0]>(schema: S, description: string) => ({ description, content: { "application/json": { schema } } })
const body = <S extends Parameters<typeof Object>[0]>(schema: S) => ({ content: { "application/json": { schema } }, required: true as const })

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
  responses: { 200: json(RulesOut, "The tenant's rule severities (block | warn | ignore per rule) and the averaging window in weeks. Anyone with roster read; defaults until an admin changes them.") },
})
const rulesPutR = createRoute({
  method: "put", path: "/v1/roster/rules", middleware: guard("write"), request: { body: body(RulesBody) },
  responses: { 200: json(RulesOut, "The settings after the change (admin or owner: 403 forbidden otherwise; audit roster.rules_changed; an unchanged set writes nothing). A rule left out gets its default. 422 invalid_rules (unknown rule id or severity) | invalid_avg_weeks (1..52).") },
})
const checkR = createRoute({
  method: "post", path: "/v1/roster/weeks/{id}/check", middleware: guard("write"), request: { params: RosterIdParam },
  responses: { 200: json(CheckOut, "A dry run: the rule violations on the people's shifts of that week, with the tenant's severities. A clash with a shift at a site the caller cannot see reads \"Already rostered elsewhere\" (no site, time or shift id) and leave, availability and hour totals carry no detail. Writes nothing. 404 not_found for a week of a site the caller may not see, a missing or another tenant's week and an id that is not a uuid.") },
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
  .openapi(limitR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => setOfficeLimit(tx, ctx, c.req.valid("param").userId, c.req.valid("json").except)), 200))
  .openapi(leaveListR, async (c) => c.json(await rosterRead(c, (tx, ctx) => listLeave(tx, ctx, c.req.valid("query"))), 200))
  .openapi(leaveCreateR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => createLeave(tx, ctx, env, c.req.valid("json")), "self"), 201))
  .openapi(leaveCancelR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => cancelLeave(tx, ctx, c.req.valid("param").id), "self"), 200))
  .openapi(leaveDecideR, async (c) => c.json(await rosterWrite(c, (tx, ctx, env) => decideLeave(tx, ctx, env, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(availGetR, async (c) => c.json(await rosterRead(c, (tx, ctx) => getAvailability(tx, ctx)), 200))
  .openapi(availPutR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => putAvailability(tx, ctx, c.req.valid("json").windows), "self"), 200))
  .openapi(rulesGetR, async (c) => c.json(await rosterRead(c, (tx, ctx) => readRules(tx, ctx.tenantId)), 200))
  .openapi(rulesPutR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => putRules(tx, ctx, c.req.valid("json"))), 200))
  .openapi(checkR, async (c) =>
    c.json(
      await rosterRead(c, async (tx, ctx) => {
        const violations = await checkWeek(tx, ctx, c.req.valid("param").id)
        return { weekId: c.req.valid("param").id, violations, blocking: violations.filter((v) => v.severity === "block").length }
      }),
      200,
    ),
  )
