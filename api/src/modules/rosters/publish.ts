import { and, asc, eq } from "drizzle-orm"
import { RULE_IDS, type RuleViolation } from "@opsdesk/domain/roster-rules"
import { canSeeLocation } from "@opsdesk/domain/roster-access"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { rosterShifts, rosterWeeks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { ShiftDto, WeekDto } from "./dto"
import { notifyRostered, weekPublishedPayload } from "./events"
import { checkWeek } from "./rules"
import { type RosterCtx } from "./scope"
import { getWeek, loadWeek, shiftDto, shiftSnap } from "./weeks"
import { auditRoster, cleanReason, isUuid, publishRoster, writeHistory, type RosterEnv } from "./write"

const unprocessable = (code: string, extra?: Record<string, unknown>) => new AppError(422, code, "Unprocessable Entity", extra)
/**
 * POST /v1/roster/weeks/{id}/publish (`{ version, reason?, overrideRuleIds? }`, R8-8..R8-10, FR-RS-23, 35). There is no unpublish (D7).
 * The week is locked FOR UPDATE under the roster lock and checked with the rule engine INSIDE this transaction, so nothing can change between the check and the publish:
 * warnings never stop it and come back in `violations`; a block stops it: 403 `rule_blocked_office_required` for a supervisor, 422 `rule_blocked` for an office role without a
 * reason (or whose `overrideRuleIds` leave a blocking rule uncovered). An office role with a reason publishes over it; the override is in history and audit.
 * A week that is already published is 409 `already_published` (a double click: one history row, one audit row, one event, one notification per person); a stale version is 409 `version_conflict`.
 * Writes in the one order: week row, history, notifications (one per rostered person), audit, the `roster.week_published` event last.
 */
export async function publishWeek(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, weekId: string, input: { version: number; reason?: string; overrideRuleIds?: string[] }): Promise<{ week: WeekDto; violations: RuleViolation[] }> {
  const loaded = await loadWeek(tx, ctx, weekId, true)
  const week = loaded.week
  if (!ctx.access.editDraft) throw Forbidden("forbidden")
  if (week.status === "published") throw Conflict("already_published")
  if (week.version !== input.version) throw Conflict("version_conflict")
  if (loaded.archived) throw Conflict("location_archived")
  const reason = cleanReason(input.reason)
  const override = input.overrideRuleIds
  if (override && (override.length > RULE_IDS.length + 1 || override.some((r) => !(RULE_IDS as readonly string[]).includes(r) && r !== "elsewhere"))) throw unprocessable("invalid_override")
  const violations = await checkWeek(tx, ctx, week.id)
  const blocks = violations.filter((v) => v.severity === "block")
  const office = ctx.access.scope === "all" && ctx.access.editPublished
  if (blocks.length > 0) {
    if (!office) throw new AppError(403, "rule_blocked_office_required", "Forbidden", { violations })
    const covered = !override || blocks.every((b) => override.includes(b.rule))
    if (!reason || !covered) throw unprocessable("rule_blocked", { violations })
  }
  const shifts = await tx.select().from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.weekId, week.id))).orderBy(asc(rosterShifts.id)).for("update")
  const [row] = await tx
    .update(rosterWeeks)
    .set({ status: "published", publishedAt: ctx.now, publishedBy: ctx.actorId, version: week.version + 1, updatedAt: ctx.now })
    .where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.id, week.id), eq(rosterWeeks.status, "draft")))
    .returning()
  if (!row) throw Conflict("already_published") // cannot happen under the lock; fail closed rather than notify twice
  const overrides = blocks.map((b) => ({ rule: b.rule, shiftId: b.shiftId, personId: b.personId }))
  await writeHistory(tx, ctx, {
    locationId: week.locationId, weekId: week.id, action: "week_published", reason, before: { status: "draft", version: week.version },
    after: { status: "published", version: row.version, shifts: shifts.length, ...(overrides.length ? { overrides } : {}) },
  })
  await notifyRostered(tx, ctx, env, shifts.map((s) => s.userId), "published", week.weekStart)
  await auditRoster(tx, ctx, {
    action: "roster.week_published", entity: "roster_week", entityId: week.id, before: { status: "draft" },
    after: { status: "published", locationId: week.locationId, weekStart: week.weekStart, shifts: shifts.length, ...(reason ? { reason } : {}), ...(overrides.length ? { overrides } : {}) },
  })
  await publishRoster(tx, ctx, "roster.week_published", weekPublishedPayload(week, shifts.map((s) => s.id)))
  return { week: (await getWeek(tx, ctx, week.id)).weeks[0], violations }
}

/**
 * POST /v1/roster/shifts/{id}/confirm (FR-RS-23): the ASSIGNED person only, on a published week. Confirming again is idempotent (200, nothing written). Someone else who can see the
 * shift is 403 forbidden (a supervisor cannot confirm for a person); a shift the caller may not see is the same 404 as a missing one or a non-uuid id. The person need not see the site
 * (staff have no location view): owning the shift is the visibility. Writes history and audit; the shift's version does not move (a confirmation is not an edit).
 */
export async function confirmShift(tx: TenantTx, ctx: RosterCtx, _env: RosterEnv, id: string): Promise<ShiftDto> {
  if (!isUuid(id)) throw NotFound()
  const [s] = await tx.select().from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, id)))
  if (!s) throw NotFound()
  if (s.userId !== ctx.me) {
    if (!canSeeLocation(ctx.access, s.locationId)) throw NotFound()
    throw Forbidden("forbidden")
  }
  const [week] = await tx.select().from(rosterWeeks).where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.id, s.weekId))).for("update")
  if (!week) throw NotFound()
  const [cur] = await tx.select().from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, id))).for("update")
  if (!cur || cur.userId !== ctx.me) throw NotFound() // reassigned while we waited for the lock
  if (week.status !== "published") throw Conflict("week_not_published")
  if (cur.confirmedAt) return shiftDto(cur)
  const [row] = await tx.update(rosterShifts).set({ confirmedAt: ctx.now, updatedAt: ctx.now }).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, id))).returning()
  await writeHistory(tx, ctx, { locationId: row.locationId, weekId: row.weekId, shiftId: row.id, action: "shift_confirmed", before: { ...shiftSnap(cur), confirmedAt: null }, after: { ...shiftSnap(row), confirmedAt: ctx.now.toISOString() } })
  await auditRoster(tx, ctx, { action: "roster.shift_confirmed", entity: "roster_shift", entityId: row.id, before: { confirmedAt: null }, after: { confirmedAt: ctx.now.toISOString() } })
  return shiftDto(row)
}
