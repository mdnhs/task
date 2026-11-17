import { and, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { Context } from "hono"
import { can } from "@opsdesk/domain/permissions"
import { taskScope, type TaskScope } from "@opsdesk/domain/task-scope"
import type { AppEnv, ResolvedRole } from "../../core/context"
import { NotFound } from "../../core/errors"
import { driveAllowed } from "../../core/middleware/device"
import { actorIdOf, subjectUserId } from "../../core/middleware/principal"
import { taskAssignees, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { lockActor } from "../rbac"
import { directReports, effectiveReportScope } from "../teams"

export type TaskRow = typeof tasks.$inferSelect

/**
 * Everything a task operation needs to know about the caller, resolved once per request (and re-resolved under the lock in a
 * mutation). `me` is whose data the caller sees (the creator for an API key), `actorId` is who DID it (`apikey:<id>` for a key).
 * `reports` are my direct reports (only read for the "team" scope). `drive` is the device policy for Drive links, per request.
 */
export type TaskCtx = { tenantId: string; tz: string; me: string; actorId: string; role: ResolvedRole; scope: TaskScope; reports: string[]; drive: boolean; now: Date }

export const TaskNotFound = () => NotFound("task_not_found")

/**
 * The caller's context. For a mutation pass `need: "write"`: the actor's membership, role and permission are then re-read inside
 * the tx with FOR SHARE (R25; API keys go through lockApiKeyActor), and scope is computed from THAT role, never the request cache.
 */
export async function loadTaskCtx(c: Context<AppEnv>, tx: TenantTx, need?: "read" | "write"): Promise<TaskCtx> {
  const deps = c.get("deps")
  const tenant = c.get("tenant")!
  const actorId = actorIdOf(c)
  const role = need ? await lockActor(tx, tenant.id, actorId, "tasks", need) : c.get("role")!
  const me = subjectUserId(c)
  const resolved = taskScope({ ...role, reportScope: await effectiveReportScope(tx, tenant.id, role) }, me)
  if (!resolved || !can(role, "tasks")) throw TaskNotFound() // no tasks:read: nothing is visible (the route guard already answered 403)
  const reports = resolved.kind === "team" ? await directReports(tx, me) : []
  return { tenantId: tenant.id, tz: tenant.timezone, me, actorId, role, scope: resolved, reports, drive: driveAllowed(c), now: deps.clock.now() }
}

/** A person is a task's creator, an assignee, or its named evidence reviewer ("own" scope). `assigneeIds` are the task's assignees. */
const ownPredicate = (me: string): SQL =>
  sql`(${tasks.creatorId} = ${me} or ${tasks.evidenceRule}->>'reviewer' = ${me} or exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.userId} = ${me}))`

/** SQL predicate on `tasks` for the scope (ruling D5): own, team (own + an assignee who reports to me), or all. */
export function taskScopeWhere(scope: TaskScope, reports: string[]): SQL {
  if (scope.kind === "all") return sql`true`
  if (scope.kind === "own") return ownPredicate(scope.personId)
  if (reports.length === 0) return ownPredicate(scope.managerId)
  return sql`(${ownPredicate(scope.managerId)} or exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${inArray(taskAssignees.userId, reports)}))`
}

/**
 * The task, or 404 task_not_found: unknown id, another tenant's, archived (unless asked) and OUT OF THE CALLER'S SCOPE all look the
 * same (no existence oracle). `forUpdate` takes the row lock a mutation needs before it checks the version.
 */
export async function getTask(tx: TenantTx, ctx: TaskCtx, id: string, o: { forUpdate?: boolean; forShare?: boolean; includeArchived?: boolean } = {}): Promise<TaskRow> {
  const q = tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.tenantId, ctx.tenantId), o.includeArchived ? undefined : sql`${tasks.archivedAt} is null`, taskScopeWhere(ctx.scope, ctx.reports)))
  // forShare: a writer that only ATTACHES to the task (an upload intent) takes the row FOR SHARE, so an archive or purge (FOR UPDATE / DELETE) cannot
  // slip in between its check and its insert (the T4.2 purge race); a task that is gone or archived by then is the same 404.
  const [row] = o.forUpdate ? await q.for("update", { of: [tasks] }) : o.forShare ? await q.for("share", { of: [tasks] }) : await q
  if (!row) throw TaskNotFound()
  return row
}

/** The same rule as taskScopeWhere, in memory (a task whose assignees are already loaded). */
export function inScope(ctx: Pick<TaskCtx, "scope" | "reports">, task: Pick<TaskRow, "creatorId" | "evidenceRule">, assignees: string[]): boolean {
  const s = ctx.scope
  if (s.kind === "all") return true
  const me = s.kind === "own" ? s.personId : s.managerId
  if (task.creatorId === me || task.evidenceRule.reviewer === me || assignees.includes(me)) return true
  return s.kind === "team" && assignees.some((a) => ctx.reports.includes(a))
}

/** Manager authority over a task (ruling D6): a manager-home role with tasks:write whose scope covers the task. */
export function canManage(ctx: TaskCtx, task: Pick<TaskRow, "creatorId" | "evidenceRule">, assignees: string[]): boolean {
  return ctx.role.home === "manager" && can(ctx.role, "tasks", "write") && inScope(ctx, task, assignees)
}
