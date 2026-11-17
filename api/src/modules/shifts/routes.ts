import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import {
  AssignmentSchema, CreateAssignmentBody, CreatePatternBody, IdParam, OccurrencesOut, OccurrencesQuery, PatchAssignmentBody, PatchPatternBody, PatternSchema, PersonReportingBody, PersonReportingOut,
  ShiftsOut, TeamParam, TeamReportingBody, TeamReportingOut, UserParam,
} from "./dto"
import { lockShifts, loadShiftCtx, type ShiftCtx } from "./scope"
import { archivePattern, createAssignment, createPattern, deleteAssignment, getShifts, listOccurrences, patchAssignment, patchPattern, setPersonReporting, setTeamReporting } from "./service"

/** A read: one tenant tx, the caller's context from the request (role as loaded by the guard). */
const read = <T>(c: Context<AppEnv>, fn: (tx: TenantTx, ctx: ShiftCtx) => Promise<T>): Promise<T> => withTenant(c.get("deps").db, c.get("tenant")!.id, async (tx) => fn(tx, await loadShiftCtx(c, tx)))

/**
 * A mutation. Lock order: the tenant's shift advisory lock FIRST, then the actor lock (R25, re-reading the role with FOR SHARE), then the rows FOR UPDATE,
 * writes, audit and the event LAST. Deadlocks and serialisation failures are 409 `retry` (app.ts).
 */
const write = <T>(c: Context<AppEnv>, fn: (tx: TenantTx, ctx: ShiftCtx) => Promise<T>): Promise<T> =>
  withTenant(c.get("deps").db, c.get("tenant")!.id, async (tx) => {
    await lockShifts(tx, c.get("tenant")!.id)
    return fn(tx, await loadShiftCtx(c, tx, "write"))
  })

const guard = (need: "read" | "write") => [requireTenant, requireModule("M1"), requirePermission("shifts", need)]
const json = <S extends Parameters<typeof Object>[0]>(schema: S, description: string) => ({ description, content: { "application/json": { schema } } })
const body = <S extends Parameters<typeof Object>[0]>(schema: S) => ({ content: { "application/json": { schema } }, required: true as const })

const getR = createRoute({
  method: "get", path: "/v1/shifts", middleware: guard("read"),
  responses: { 200: json(ShiftsOut, "Live patterns, assignments (open or ended within 92 days), active members with team ids and primary manager, and the reporting settings. A staff-home caller gets only their own cut (own assignments, their patterns, own override, their teams' defaults, own primary manager)") },
})
const occR = createRoute({
  method: "get", path: "/v1/shifts/occurrences", middleware: guard("read"), request: { query: OccurrencesQuery },
  responses: { 200: json(OccurrencesOut, "Shifts that START between from and to (a shift belongs to its start date in the pattern's zone; instants are UTC; start/end are tenant wall clock). 422 invalid_range | range_too_long (31 dates). Staff see only their own") },
})
const createPatternR = createRoute({
  method: "post", path: "/v1/shifts/patterns", middleware: guard("write"), request: { body: body(CreatePatternBody) },
  responses: { 201: json(PatternSchema, "The new pattern (all-scope managers only: 403 forbidden for a team-scope manager). 404 team_not_found; 409 pattern_name_taken; 422 invalid_pattern | invalid_pattern_zone") },
})
const patchPatternR = createRoute({
  method: "patch", path: "/v1/shifts/patterns/{id}", middleware: guard("write"), request: { params: IdParam, body: body(PatchPatternBody) },
  responses: { 200: json(PatternSchema, "The updated pattern; only shifts not yet reported change (all-scope managers only). 404 shift_pattern_not_found | team_not_found; 409 version_conflict | pattern_name_taken; 422 invalid_pattern | invalid_pattern_zone") },
})
const deletePatternR = createRoute({
  method: "delete", path: "/v1/shifts/patterns/{id}", middleware: guard("write"), request: { params: IdParam },
  responses: { 204: { description: "The pattern is archived (never deleted): no new shifts or assignments; reports, history and assignment rows stay. 404 shift_pattern_not_found" } },
})
const createAssignmentR = createRoute({
  method: "post", path: "/v1/shifts/assignments", middleware: guard("write"), request: { body: body(CreateAssignmentBody) },
  responses: { 201: json(AssignmentSchema, "The new assignment. 404 shift_pattern_not_found; 422 invalid_assignment (not an active member with reports or tasks access, an archived pattern, bad dates or an overlap with another assignment of the same member and pattern) | assignee_out_of_scope (team-scope manager: only themself and their direct reports)") },
})
const patchAssignmentR = createRoute({
  method: "patch", path: "/v1/shifts/assignments/{id}", middleware: guard("write"), request: { params: IdParam, body: body(PatchAssignmentBody) },
  responses: { 200: json(AssignmentSchema, "The assignment with its new end date (history kept); null re-opens it. 404 shift_assignment_not_found; 422 invalid_assignment") },
})
const deleteAssignmentR = createRoute({
  method: "delete", path: "/v1/shifts/assignments/{id}", middleware: guard("write"), request: { params: IdParam },
  responses: { 204: { description: "Deleted (only while its from date is after today). 404 shift_assignment_not_found; 409 assignment_started" } },
})
const teamReportingR = createRoute({
  method: "put", path: "/v1/shifts/reporting/teams/{teamId}", middleware: guard("write"), request: { params: TeamParam, body: body(TeamReportingBody) },
  responses: { 200: json(TeamReportingOut, "The team default for end-of-shift reporting (all-scope managers only). 404 team_not_found") },
})
const personReportingR = createRoute({
  method: "put", path: "/v1/shifts/reporting/people/{userId}", middleware: guard("write"), request: { params: UserParam, body: body(PersonReportingBody) },
  responses: { 200: json(PersonReportingOut, "A per-person override; null follows the team default again. 404 not_a_member; 422 assignee_out_of_scope (team-scope manager: only themself and their direct reports)") },
})

export const shiftRoutes = newRouter()
  .openapi(getR, async (c) => c.json(await read(c, (tx, ctx) => getShifts(tx, ctx)), 200))
  .openapi(occR, async (c) => c.json(await read(c, (tx, ctx) => listOccurrences(tx, ctx, c.req.valid("query"))), 200))
  .openapi(createPatternR, async (c) => c.json(await write(c, (tx, ctx) => createPattern(tx, ctx, c.req.valid("json"))), 201))
  .openapi(patchPatternR, async (c) => c.json(await write(c, (tx, ctx) => patchPattern(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(deletePatternR, async (c) => {
    await write(c, (tx, ctx) => archivePattern(tx, ctx, c.req.valid("param").id))
    return c.body(null, 204)
  })
  .openapi(createAssignmentR, async (c) => c.json(await write(c, (tx, ctx) => createAssignment(tx, ctx, c.req.valid("json"))), 201))
  .openapi(patchAssignmentR, async (c) => c.json(await write(c, (tx, ctx) => patchAssignment(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(deleteAssignmentR, async (c) => {
    await write(c, (tx, ctx) => deleteAssignment(tx, ctx, c.req.valid("param").id))
    return c.body(null, 204)
  })
  .openapi(teamReportingR, async (c) => c.json(await write(c, (tx, ctx) => setTeamReporting(tx, ctx, c.req.valid("param").teamId, c.req.valid("json").on)), 200))
  .openapi(personReportingR, async (c) => c.json(await write(c, (tx, ctx) => setPersonReporting(tx, ctx, c.req.valid("param").userId, c.req.valid("json").on)), 200))
