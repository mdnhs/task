import { sql } from "drizzle-orm"
import type { Context } from "hono"
import { can, shiftScope } from "@opsdesk/domain/permissions"
import type { AppEnv, ResolvedRole } from "../../core/context"
import { Forbidden } from "../../core/errors"
import { actorIdOf, subjectUserId } from "../../core/middleware/principal"
import type { TenantTx } from "../../db/tenant-tx"
import { lockActor } from "../rbac"
import { directReports, effectiveReportScope } from "../teams"

/**
 * Two-key advisory lock namespace for pattern, assignment and reporting edits ("shif"). One writer per tenant, taken FIRST (before lockActor
 * and any row lock), released at commit/rollback. It is what makes the overlap check of two concurrent assignment POSTs race-free (no btree_gist).
 */
export const SHIFT_LOCK_NS = 0x73686966

export const lockShifts = (tx: TenantTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(${SHIFT_LOCK_NS}::int, hashtext(${tenantId}::text))`)

/**
 * Everything a shift operation needs to know about the caller. `me` is whose data the caller sees (the creator for an API key), `actorId` is who
 * DID it. `view`: "own" = staff-home readers see only their own shifts (the ownShiftState cut), "all" = everyone (shiftScope). `write`: "all" =
 * anyone and the patterns/team defaults; "team" = a manager-home role with the template reportScope "team" (following cloned_from): only
 * themself and their direct reports (E2), no pattern or team-default edits (F14).
 */
export type ShiftCtx = { tenantId: string; tz: string; me: string; actorId: string; role: ResolvedRole; view: "own" | "all"; write: "all" | "team"; reports: string[]; now: Date }

/** The caller's context; for a mutation pass `need: "write"`: the actor's membership, role and permission are re-read inside the tx with FOR SHARE (R25). */
export async function loadShiftCtx(c: Context<AppEnv>, tx: TenantTx, need: "read" | "write" = "read"): Promise<ShiftCtx> {
  const tenant = c.get("tenant")!
  const actorId = actorIdOf(c)
  const role = need === "write" ? await lockActor(tx, tenant.id, actorId, "shifts", "write") : c.get("role")!
  const view = shiftScope(role)
  if (view === "none" || !can(role, "shifts", need)) throw Forbidden("forbidden") // the route guard already answered; fail closed
  const me = subjectUserId(c)
  const team = role.home === "manager" && (await effectiveReportScope(tx, tenant.id, role)) === "team"
  return { tenantId: tenant.id, tz: tenant.timezone, me, actorId, role, view, write: team ? "team" : "all", reports: team ? await directReports(tx, me) : [], now: c.get("deps").clock.now() }
}

/** Who a team-scope manager may assign or set reporting for (E2): themself and their direct reports. */
export const inWriteScope = (ctx: ShiftCtx, userId: string): boolean => ctx.write === "all" || userId === ctx.me || ctx.reports.includes(userId)
