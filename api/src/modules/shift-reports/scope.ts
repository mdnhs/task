import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { Context } from "hono"
import type { ReportAccess } from "@opsdesk/domain/permissions"
import type { AppEnv, ResolvedRole } from "../../core/context"
import { Forbidden, NotFound } from "../../core/errors"
import { driveAllowed } from "../../core/middleware/device"
import { actorIdOf, subjectUserId } from "../../core/middleware/principal"
import { shiftReports } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { lockActor } from "../rbac"
import { directReports, peopleAccess } from "../teams"
import { taskCtxOf, type TaskCtx } from "../tasks"

export type ReportRow = typeof shiftReports.$inferSelect

export const ReportNotFound = () => NotFound("report_not_found")

/**
 * Everything a report operation needs to know about the caller. `me` is whose data the caller sees (the creator for an API key), `actorId` is who DID it.
 * `access` is the report scope (ruling F5): staff-home → own, a manager-home role with the template reportScope "team" → me + my DIRECT reports (one level, the
 * same rule as tasks), other manager-home roles → all. `task` is the caller's task context (null when the role has no tasks access: a report then has no rows).
 */
export type ReportCtx = { tenantId: string; tz: string; me: string; actorId: string; role: ResolvedRole; access: ReportAccess; reports: string[]; task: TaskCtx | null; drive: boolean; now: Date }

/**
 * The caller's context. For a mutation pass `need: "write"`: the actor's membership, role and `reports:write` are re-read inside the tx with FOR SHARE (R25; API keys
 * go through lockApiKeyActor) and the scope is computed from THAT role, never the request cache. A role with no reports access at all is 404 (the guard answered 403 first).
 */
export async function loadReportCtx(c: Context<AppEnv>, tx: TenantTx, need: "read" | "write" = "read"): Promise<ReportCtx> {
  const tenant = c.get("tenant")!
  const actorId = actorIdOf(c)
  const role = need === "write" ? await lockActor(tx, tenant.id, actorId, "reports", "write") : c.get("role")!
  const me = subjectUserId(c)
  const access = await peopleAccess(tx, tenant.id, role, me)
  if (!access) throw ReportNotFound()
  const reports = access.kind === "team" ? await directReports(tx, me) : []
  return { tenantId: tenant.id, tz: tenant.timezone, me, actorId, role, access, reports, task: await taskCtxOf(c, tx, role), drive: driveAllowed(c), now: c.get("deps").clock.now() }
}

/** SQL predicate on `shift_reports` for the scope (ruling F5). */
export function reportScopeWhere(ctx: Pick<ReportCtx, "access" | "reports" | "me">): SQL {
  const a = ctx.access
  if (a.kind === "all") return sql`true`
  if (a.kind === "own") return eq(shiftReports.userId, a.personId)
  return inArray(shiftReports.userId, [a.managerId, ...ctx.reports])
}

/**
 * The report, or 404 report_not_found: an unknown id, another tenant's and one OUTSIDE THE CALLER'S SCOPE all look the same (no existence oracle).
 * `forUpdate` takes the row lock a mutation needs before it checks the version (lock order: actor, then the report row, then its task rows by id).
 */
export async function getReport(tx: TenantTx, ctx: ReportCtx, id: string, o: { forUpdate?: boolean } = {}): Promise<ReportRow> {
  const q = tx.select().from(shiftReports).where(and(eq(shiftReports.id, id), eq(shiftReports.tenantId, ctx.tenantId), reportScopeWhere(ctx)))
  const [row] = o.forUpdate ? await q.for("update") : await q
  if (!row) throw ReportNotFound()
  return row
}

/** Only the report's OWNER edits, uploads or submits (FR-M1-27). A reader who may see it but is not the owner (a manager) is 403 forbidden. */
export function assertOwner(ctx: Pick<ReportCtx, "me">, row: Pick<ReportRow, "userId">): void {
  if (row.userId !== ctx.me) throw Forbidden("forbidden")
}

/** A report is editable while it is a draft or has been returned (ruling F7). */
export const editable = (status: string): boolean => status === "draft" || status === "returned"
