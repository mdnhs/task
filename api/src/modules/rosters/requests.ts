import { and, desc, eq, lt, or } from "drizzle-orm"
import { canSeeLocation } from "@opsdesk/domain/roster-access"
import { decodeCursor, encodeCursor } from "../../core/cursor"
import { Conflict, Forbidden, NotFound } from "../../core/errors"
import { rosterChangeRequests, rosterShifts } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { ChangeRequestDto, ShiftDto } from "./dto"
import { approversOf, notifyActive } from "./events"
import { applyShiftPatch, loadShift, parsePatch, resolvePatch, unprocessable, type Patch } from "./shifts"
import { assertLocation, inScopeSql, weekEditGate, type RosterCtx } from "./scope"
import type { RuleViolation } from "@opsdesk/domain/roster-rules"
import { auditRoster, checkOverrideIds, cleanReason, isUuid, officeOnly, publishRoster, writeHistory, type RosterEnv } from "./write"

// Change requests (FR-RS-36). A supervisor may not edit a published week; they ask for a change and an office role decides. The request keeps the shift VERSION it was made against
// (`shift_version`): an approval of a shift that changed since is 409 `stale_request`. An approval applies the patch through the SAME helper as an office edit (`applyShiftPatch`):
// eligibility and the rule engine run again inside the roster write, a new block needs the office override contract (`overrideReason` and the rule ids), history carries the requester's reason.

const notFound = () => NotFound("change_request_not_found")
const NOTE_MAX = 500
const STATUSES = ["requested", "approved", "rejected"] as const
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const CONTROL = /[\u0000-\u001f\u007f]/

type Row = typeof rosterChangeRequests.$inferSelect
type View = { row: Row; weekId: string; locationId: string }
const view = ({ row: r, weekId, locationId }: View): ChangeRequestDto => ({
  id: r.id, shiftId: r.shiftId, weekId, locationId, shiftVersion: r.shiftVersion, requestedBy: r.requestedBy, patch: r.patch as ChangeRequestDto["patch"], reason: r.reason,
  status: r.status as ChangeRequestDto["status"], decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote, createdAt: r.createdAt.toISOString(),
})

/** POST /v1/roster/shifts/{id}/change-requests: a supervisor (or office) asks for a change to a shift of a PUBLISHED week. A draft week is edited directly (409 use_direct_edit). */
export async function createChangeRequest(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, shiftId: string, input: { patch: Record<string, unknown>; reason?: string }): Promise<ChangeRequestDto> {
  if (!ctx.access.editDraft) throw Forbidden("forbidden") // the route guard already answered; fail closed
  const { shift: cur, loaded } = await loadShift(tx, ctx, shiftId)
  if (loaded.week.status !== "published") throw Conflict("use_direct_edit")
  if (loaded.archived) throw Conflict("location_archived")
  const reason = cleanReason(input.reason)
  if (reason === null) throw unprocessable("reason_required")
  const patch: Patch = parsePatch(input.patch)
  const plan = await resolvePatch(tx, ctx, cur, loaded, patch) // the same validation an edit does (422), nothing written
  if (plan.same) throw unprocessable("invalid_patch") // a request that changes nothing
  const [row] = await tx
    .insert(rosterChangeRequests)
    .values({ tenantId: ctx.tenantId, shiftId: cur.id, shiftVersion: cur.version, requestedBy: ctx.me, patch, reason, status: "requested", createdAt: ctx.now, updatedAt: ctx.now })
    .returning()
  const dto = view({ row, weekId: cur.weekId, locationId: cur.locationId })
  await writeHistory(tx, ctx, { locationId: cur.locationId, weekId: cur.weekId, shiftId: cur.id, action: "change_requested", reason, after: { requestId: row.id, shiftVersion: cur.version, patch } })
  const askers = await approversOf(tx, ctx.tenantId, cur.locationId, { supervisors: false, exclude: [ctx.me] })
  await notifyActive(tx, ctx, env, askers.map((userId) => ({ userId, title: "Roster change requested", body: "{{subject}} asked for a change to a published shift. Review it in the roster.", subjectUserId: ctx.me })))
  await auditRoster(tx, ctx, { action: "roster.change_requested", entity: "roster_change_request", entityId: row.id, before: null, after: { shiftId: cur.id, locationId: cur.locationId, shiftVersion: cur.version, patch, reason } })
  await publishRoster(tx, ctx, "roster.change_requested", { requestId: row.id, shiftId: cur.id, weekId: cur.weekId, locationId: cur.locationId })
  return dto
}

/** GET /v1/roster/change-requests?status=&locationId=: the requests of the sites the caller sees (a supervisor: their own; staff: none). Newest first, keyset cursor. */
export async function listChangeRequests(tx: TenantTx, ctx: RosterCtx, q: { status?: string; locationId?: string; limit?: string; cursor?: string }): Promise<{ items: ChangeRequestDto[]; nextCursor: string | null }> {
  if (q.status !== undefined && !(STATUSES as readonly string[]).includes(q.status)) throw unprocessable("invalid_filter")
  const limit = q.limit === undefined ? DEFAULT_LIMIT : /^\d{1,3}$/.test(q.limit) ? Number(q.limit) : 0
  if (limit < 1 || limit > MAX_LIMIT) throw unprocessable("invalid_filter")
  if (q.locationId !== undefined) assertLocation(ctx, q.locationId)
  const after = q.cursor === undefined ? undefined : decodeCursor(q.cursor)
  const rows = await tx
    .select({ row: rosterChangeRequests, weekId: rosterShifts.weekId, locationId: rosterShifts.locationId })
    .from(rosterChangeRequests)
    .innerJoin(rosterShifts, and(eq(rosterShifts.tenantId, rosterChangeRequests.tenantId), eq(rosterShifts.id, rosterChangeRequests.shiftId)))
    .where(
      and(
        eq(rosterChangeRequests.tenantId, ctx.tenantId), inScopeSql(ctx, rosterShifts.locationId),
        q.status ? eq(rosterChangeRequests.status, q.status) : undefined,
        q.locationId ? eq(rosterShifts.locationId, q.locationId) : undefined,
        after ? or(lt(rosterChangeRequests.createdAt, after.at), and(eq(rosterChangeRequests.createdAt, after.at), lt(rosterChangeRequests.id, after.id))) : undefined,
      ),
    )
    .orderBy(desc(rosterChangeRequests.createdAt), desc(rosterChangeRequests.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page.map(view), nextCursor: rows.length > limit && last ? encodeCursor(last.row.createdAt, last.row.id) : null }
}

const cleanNote = (v: string | undefined): string | null => {
  const t = (v ?? "").trim()
  if (t.length > NOTE_MAX || CONTROL.test(t.replace(/[\r\n\t]/g, " "))) throw unprocessable("invalid_decision")
  return t === "" ? null : t
}

/**
 * POST /v1/roster/change-requests/{id}/decide (`{ decision, note?, overrideReason?, overrideRuleIds? }`): an office role only (a supervisor who can see the request is 403, one who cannot is 404).
 * Never your own request and never a change to your own shift (403 self_decision). A request already decided is 409 already_decided; an approval of a shift that changed since the request
 * is 409 stale_request and the request stays open (rejecting it is still possible). Approve = the office edit of the patch (rules and eligibility run again; a new block is 422 rule_blocked
 * unless `overrideReason` is given and `overrideRuleIds` names the rules); the person confirms again and is told, the requester is told; reject changes nothing but the request.
 */
export async function decideChangeRequest(
  tx: TenantTx, ctx: RosterCtx, env: RosterEnv, id: string, input: { decision: "approve" | "reject"; note?: string; overrideReason?: string; overrideRuleIds?: string[] },
): Promise<{ request: ChangeRequestDto; shift: ShiftDto | null; violations: RuleViolation[] }> {
  if (!isUuid(id)) throw notFound()
  const [found] = await tx
    .select({ shiftId: rosterChangeRequests.shiftId, locationId: rosterShifts.locationId })
    .from(rosterChangeRequests)
    .innerJoin(rosterShifts, and(eq(rosterShifts.tenantId, rosterChangeRequests.tenantId), eq(rosterShifts.id, rosterChangeRequests.shiftId)))
    .where(and(eq(rosterChangeRequests.tenantId, ctx.tenantId), eq(rosterChangeRequests.id, id)))
  if (!found || !canSeeLocation(ctx.access, found.locationId)) throw notFound() // missing, another tenant's, another site's and not a uuid: one answer
  officeOnly(ctx)
  const note = cleanNote(input.note)
  const overrideReason = cleanReason(input.overrideReason)
  const overrideIds = checkOverrideIds(input.overrideRuleIds)
  const { shift: cur, loaded } = await loadShift(tx, ctx, found.shiftId) // week FOR UPDATE, then the shift, then the request (one fixed order)
  const [row] = await tx.select().from(rosterChangeRequests).where(and(eq(rosterChangeRequests.tenantId, ctx.tenantId), eq(rosterChangeRequests.id, id))).for("update")
  if (!row) throw notFound()
  if (row.requestedBy === ctx.me) throw Forbidden("self_decision")
  if (row.status !== "requested") throw Conflict("already_decided")
  const patch = parsePatch(row.patch)
  const approve = input.decision === "approve"
  let shift: ShiftDto | null = null
  let violations: RuleViolation[] = []
  let done: () => Promise<void> = async () => undefined
  if (approve) {
    if (cur.userId === ctx.me || patch.userId === ctx.me) throw Forbidden("self_decision") // nobody approves a change to their own shift
    if (cur.version !== row.shiftVersion) throw Conflict("stale_request")
    weekEditGate(ctx, { status: loaded.week.status as "draft" | "published" }, row.reason) // an office role on a published week, with the requester's reason
    const out = await applyShiftPatch(tx, ctx, env, cur, loaded, patch, { reason: row.reason, gateReason: overrideReason ?? undefined, overrideRuleIds: overrideIds, extra: { changeRequestId: row.id, ...(overrideReason ? { overrideReason } : {}) } })
    shift = out.shift
    violations = out.violations
    done = out.done
  }
  const status = approve ? "approved" : "rejected"
  const [next] = await tx
    .update(rosterChangeRequests)
    .set({ status, decidedBy: ctx.me, decidedAt: ctx.now, decisionNote: note, updatedAt: ctx.now })
    .where(and(eq(rosterChangeRequests.tenantId, ctx.tenantId), eq(rosterChangeRequests.id, row.id)))
    .returning()
  await writeHistory(tx, ctx, { locationId: cur.locationId, weekId: cur.weekId, shiftId: cur.id, action: approve ? "change_approved" : "change_rejected", reason: note, before: { requestId: row.id, status: row.status }, after: { requestId: row.id, status } })
  await notifyActive(tx, ctx, env, [{ userId: row.requestedBy, title: approve ? "Change request approved" : "Change request rejected", body: `Your roster change request was ${status}.${note ? ` Note: ${note}` : ""}` }])
  await auditRoster(tx, ctx, { action: "roster.change_decided", entity: "roster_change_request", entityId: row.id, before: { status: row.status }, after: { status, shiftId: cur.id, requestedBy: row.requestedBy, ...(note ? { note } : {}), ...(overrideReason && approve ? { overrideReason } : {}) } })
  await done()
  await publishRoster(tx, ctx, "roster.change_decided", { requestId: row.id, shiftId: cur.id, weekId: cur.weekId, locationId: cur.locationId, decision: input.decision, requestedBy: row.requestedBy })
  return { request: view({ row: next, weekId: cur.weekId, locationId: cur.locationId }), shift, violations }
}
