import { createRoute } from "@hono/zod-openapi"
import { newRouter } from "../../core/router"
import {
  CreateLocationBody, CreateShiftTypeBody, LocationSchema, LocationsOut, LocationsQuery, OfficeLimitBody, OfficeLimitOut, PatchLocationBody, PatchShiftTypeBody, RosterIdParam, RosterUserParam,
  ShiftTypeSchema, ShiftTypesOut, ShiftTypesQuery, SupervisorsBody, SupervisorsOut, TargetsBody,
} from "./dto"
import { archiveLocation, archiveShiftType, createLocation, createShiftType, getLocation, listLocations, listShiftTypes, patchLocation, patchShiftType, setOfficeLimit, setSupervisors, setTargets } from "./locations"
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
  .openapi(limitR, async (c) => c.json(await rosterWrite(c, (tx, ctx) => setOfficeLimit(tx, ctx, c.req.valid("param").userId, c.req.valid("json").except)), 200))
