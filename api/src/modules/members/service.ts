import { and, asc, count, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { epochToWall } from "@opsdesk/domain/shifts"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { publish } from "../../core/events"
import { API_KEY_ACTOR_PREFIX } from "../../core/middleware/principal"
import {
  leaveRequests, locationSupervisors, memberships, roles, rosterChangeRequests, rosterExchanges, rosterShifts, session, shiftAssignments,
} from "../../db/schema"
import { withUser, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { assertSeatAvailable } from "../entitlements"
import { notify, SUBJECT_TOKEN, type Enqueue } from "../notifications"
import { assertNoEscalation, lockActor, lockRbac } from "../rbac"
import { ROSTER_LOCK_TIMEOUT_MS, lockRoster, writeHistory } from "../rosters"
import { lockShifts } from "../shifts"

type Actor = { userId: string }
export type MemberStatusDto = { userId: string; status: "active" | "deactivated"; deactivatedAt: string | null }
export type LifecycleEnv = { deps: Deps; enqueue: Enqueue }

const humanActorOnly = (actor: Actor): void => {
  if (actor.userId.startsWith(API_KEY_ACTOR_PREFIX)) throw Forbidden("api_key_forbidden_route") // defence in depth behind the /v1/members deny-list
}

/** The target's membership row locked FOR UPDATE with its role; the same 404 for a missing member and one of another tenant. */
async function lockedTarget(tx: TenantTx, tenantId: string, userId: string) {
  const [m] = await tx
    .select({ status: memberships.status, deactivatedAt: memberships.deactivatedAt, roleKey: roles.key, access: roles.access })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .for("update", { of: memberships })
  if (!m) throw NotFound("member_not_found")
  return m
}

/**
 * POST /v1/members/{userId}/deactivate (owner or admin: settings write). The member keeps their history, shifts and audit trail but cannot reach the tenant
 * any more (requireTenant treats a non-active membership as a non-member; an API key of theirs stops working too).
 *
 * Lock order: RBAC lock, shift lock, roster lock (the three advisory locks every writer of what we touch takes first), then the actor (R25), then the target
 * row and, for an owner, every active owner row. Writes: status, open shift assignments end TODAY (leftOn, tenant zone; assignments that start later are
 * removed), open roster exchanges are cancelled, pending change requests rejected and pending leave cancelled; then roster history (one line per location
 * where the person still has upcoming shifts: the `left` rule flags those, nothing is moved), notices to the active supervisors of those locations, audit, event.
 * Their supervisor grants stay (a deactivated person is not listed as a supervisor, and reactivation restores them).
 */
export async function deactivateMember(tx: TenantTx, env: LifecycleEnv, tenant: { id: string; tz: string }, actor: Actor, userId: string): Promise<MemberStatusDto> {
  humanActorOnly(actor)
  const tenantId = tenant.id
  // the same 5 s bound as every roster writer, set BEFORE the first advisory lock: a stuck RBAC, shift or roster writer is a 55P03 -> 409 retry, never a hang
  await tx.execute(sql.raw(`set local lock_timeout = ${ROSTER_LOCK_TIMEOUT_MS}`))
  await lockRbac(tx, tenantId)
  await lockShifts(tx, tenantId)
  await lockRoster(tx, tenantId)
  const me = await lockActor(tx, tenantId, actor.userId, "settings", "write")
  const m = await lockedTarget(tx, tenantId, userId)
  if (m.status === "deactivated") throw Conflict("already_deactivated")
  if (m.roleKey === "owner") {
    // every active owner row locked in a stable order, so two concurrent deactivations cannot both pass the count (the B1 guard); first, so the sole owner
    // (who is also the likeliest to click) gets the explicit last_owner answer
    const owners = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), eq(roles.key, "owner")))
      .orderBy(memberships.userId)
      .for("update", { of: memberships })
    if (owners.length <= 1) throw Conflict("last_owner") // 409 like the role-change and erasure guards
  }
  if (userId === actor.userId) throw new AppError(422, "self_deactivation", "Unprocessable Entity")
  assertNoEscalation(me, m.access as Record<string, string>) // never act on someone who outranks you (R24)
  if (m.roleKey === "owner" && me.key !== "owner") throw Forbidden("role_escalation")
  const now = env.deps.clock.now()
  const leftOn = epochToWall(now.getTime(), tenant.tz).slice(0, 10)
  await tx.update(memberships).set({ status: "deactivated", deactivatedAt: now }).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))

  const removed = await tx.delete(shiftAssignments).where(and(eq(shiftAssignments.tenantId, tenantId), eq(shiftAssignments.userId, userId), gt(shiftAssignments.fromDate, leftOn))).returning({ id: shiftAssignments.id })
  const ended = await tx
    .update(shiftAssignments)
    .set({ untilDate: leftOn })
    .where(and(eq(shiftAssignments.tenantId, tenantId), eq(shiftAssignments.userId, userId), lte(shiftAssignments.fromDate, leftOn), or(isNull(shiftAssignments.untilDate), gt(shiftAssignments.untilDate, leftOn))))
    .returning({ id: shiftAssignments.id })
  const exchanges = await tx
    .update(rosterExchanges)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(rosterExchanges.tenantId, tenantId), or(eq(rosterExchanges.fromUserId, userId), eq(rosterExchanges.toUserId, userId)), inArray(rosterExchanges.status, ["requested", "recommended"])))
    .returning({ id: rosterExchanges.id })
  const changes = await tx
    .update(rosterChangeRequests)
    .set({ status: "rejected", decisionNote: "member_deactivated", decidedAt: now, updatedAt: now })
    .where(and(eq(rosterChangeRequests.tenantId, tenantId), eq(rosterChangeRequests.requestedBy, userId), eq(rosterChangeRequests.status, "requested")))
    .returning({ id: rosterChangeRequests.id })
  const leave = await tx
    .update(leaveRequests)
    .set({ status: "cancelled", updatedAt: now })
    .where(and(eq(leaveRequests.tenantId, tenantId), eq(leaveRequests.userId, userId), eq(leaveRequests.status, "requested")))
    .returning({ id: leaveRequests.id })

  // the places the person is still rostered (upcoming shifts stay, flagged by the `left` rule from the deactivation date on)
  const upcoming = await tx
    .select({ locationId: rosterShifts.locationId, n: count() })
    .from(rosterShifts)
    .where(and(eq(rosterShifts.tenantId, tenantId), eq(rosterShifts.userId, userId), gt(rosterShifts.endAt, now)))
    .groupBy(rosterShifts.locationId)
    .orderBy(asc(rosterShifts.locationId))
  for (const u of upcoming) await writeHistory(tx, { tenantId, actorId: actor.userId, now }, { locationId: u.locationId, action: "member_deactivated", after: { userId, leftOn, upcomingShifts: Number(u.n) } })
  if (upcoming.length > 0) {
    const supervisors = await tx
      .select({ userId: locationSupervisors.userId })
      .from(locationSupervisors)
      .innerJoin(memberships, and(eq(memberships.tenantId, locationSupervisors.tenantId), eq(memberships.userId, locationSupervisors.userId), eq(memberships.status, "active")))
      .where(and(eq(locationSupervisors.tenantId, tenantId), inArray(locationSupervisors.locationId, upcoming.map((u) => u.locationId))))
      .orderBy(asc(locationSupervisors.userId))
    for (const to of [...new Set(supervisors.map((s) => s.userId))].filter((u) => u !== actor.userId && u !== userId)) {
      // the name is not stored: the body carries {{subject}}, rendered when the notice is read or sent
      await notify(tx, tenantId, { userId: to, kind: "member", title: "Team member deactivated", body: `${SUBJECT_TOKEN} was deactivated and still has upcoming shifts at your location.`, link: "/rosters", subjectUserId: userId }, env.deps, env.enqueue)
    }
  }
  await recordAudit(
    tx, tenantId,
    {
      action: "member.deactivated", entity: "membership", entityId: userId, actorId: actor.userId, before: { status: "active" },
      after: { status: "deactivated", leftOn, endedAssignments: ended.length, removedFutureAssignments: removed.length, cancelledExchanges: exchanges.length, rejectedChangeRequests: changes.length, cancelledLeave: leave.length },
    },
    now,
  )
  await publish(tx, { tenantId, type: "member.deactivated", payload: { userId, leftOn }, actorId: actor.userId }, now)
  return { userId, status: "deactivated", deactivatedAt: now.toISOString() }
}

/** POST /v1/members/{userId}/reactivate: the person is active again (a seat must be free: 409 seat_limit). Assignments that ended stay ended; grants and history are as they were. */
export async function reactivateMember(tx: TenantTx, env: LifecycleEnv, tenant: { id: string }, actor: Actor, userId: string): Promise<MemberStatusDto> {
  humanActorOnly(actor)
  const tenantId = tenant.id
  await lockRbac(tx, tenantId)
  const me = await lockActor(tx, tenantId, actor.userId, "settings", "write")
  const m = await lockedTarget(tx, tenantId, userId)
  if (m.status !== "deactivated") throw Conflict("not_deactivated")
  assertNoEscalation(me, m.access as Record<string, string>)
  if (m.roleKey === "owner" && me.key !== "owner") throw Forbidden("role_escalation")
  await assertSeatAvailable(tx, tenantId)
  const now = env.deps.clock.now()
  await tx.update(memberships).set({ status: "active", deactivatedAt: null }).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
  await recordAudit(tx, tenantId, { action: "member.reactivated", entity: "membership", entityId: userId, actorId: actor.userId, before: { status: "deactivated", deactivatedAt: m.deactivatedAt }, after: { status: "active" } }, now)
  await publish(tx, { tenantId, type: "member.reactivated", payload: { userId }, actorId: actor.userId }, now)
  return { userId, status: "active", deactivatedAt: null }
}

/**
 * After the deactivation COMMITS: sign the person out everywhere when this was their last active membership. A person who still belongs to another workspace keeps
 * their sessions (they are global, not per tenant); the tenant gate already answers 404 for this workspace. Never fails the request (the gate holds either way).
 */
export async function revokeSessionsIfOrphaned(deps: Deps, userId: string): Promise<void> {
  try {
    const [r] = await withUser(deps.db, userId, (tx) => tx.select({ n: count() }).from(memberships).where(and(eq(memberships.userId, userId), eq(memberships.status, "active"))))
    if ((r?.n ?? 0) === 0) await deps.db.delete(session).where(eq(session.userId, userId))
  } catch (err) {
    deps.logger.error({ userId, errCode: (err as { code?: string } | null)?.code ?? "error" }, "session revoke after deactivation failed")
  }
}
