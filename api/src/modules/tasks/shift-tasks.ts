import { and, asc, eq, lt, sql, type SQL } from "drizzle-orm"
import type { EvidenceRule } from "@opsdesk/domain/task-evidence"
import { taskAssignees, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { taskScopeWhere, type TaskCtx } from "./scope"

/** A task of a person's shift (the SQL form of the domain `taskInShift`). `evidenceRequired` = the task's evidence rule is Required. */
export type ShiftTaskRow = { taskId: string; ref: string; title: string; status: string; dueAt: Date; evidenceRequired: boolean }

/** The finish time of a finished task, the domain rule: completed_at, else submitted_at, else the due time. */
const FINISHED_AT = sql`coalesce(${tasks.completedAt}, ${tasks.submittedAt}, ${tasks.dueAt})`

/**
 * The statement itself (exported so the EXPLAIN test plans exactly what runs): live tasks that `personId` is an assignee of (primary or other), not
 * cancelled, that START before the window ends, and are not FINISHED (submitted or completed) before the window starts (ruling F9). Earliest due first,
 * `TSK-` number breaks ties. ANDed with the caller's task scope (ruling D5): a task the caller may not see is never returned, whoever `personId` is.
 */
export function shiftTasksQuery(tx: TenantTx, ctx: Pick<TaskCtx, "tenantId" | "scope" | "reports">, personId: string, window: { fromUtc: Date; toUtc: Date }, extra?: SQL) {
  return tx
    .select({ id: tasks.id, refNo: tasks.refNo, title: tasks.title, status: tasks.status, dueAt: tasks.dueAt, rule: tasks.evidenceRule })
    .from(taskAssignees)
    .innerJoin(tasks, and(eq(tasks.tenantId, taskAssignees.tenantId), eq(tasks.id, taskAssignees.taskId)))
    .where(
      and(
        eq(taskAssignees.tenantId, ctx.tenantId),
        eq(taskAssignees.userId, personId),
        sql`${tasks.archivedAt} is null`,
        sql`${tasks.status} <> 'cancelled'`,
        lt(tasks.startAt, window.toUtc),
        sql`not (${tasks.status} in ('submitted', 'completed') and ${FINISHED_AT} < ${window.fromUtc.toISOString()}::timestamptz)`,
        taskScopeWhere(ctx.scope, ctx.reports),
        extra,
      ),
    )
    .orderBy(asc(tasks.dueAt), asc(tasks.refNo))
}

/**
 * E3 / F9: the tasks of one person's shift, scope-filtered. The window is the shift's real instants (never wall strings). Archived and cancelled tasks are
 * out; a task finished before the shift began belongs to an earlier shift. The caller's identity is `ctx` (for an API key, its creator: `ctx.me`).
 */
export async function listTasksForPerson(tx: TenantTx, ctx: Pick<TaskCtx, "tenantId" | "scope" | "reports">, personId: string, window: { fromUtc: Date; toUtc: Date }): Promise<ShiftTaskRow[]> {
  const rows = await shiftTasksQuery(tx, ctx, personId, window)
  return rows.map((r) => ({ taskId: r.id, ref: `TSK-${r.refNo}`, title: r.title, status: r.status, dueAt: r.dueAt, evidenceRequired: (r.rule as EvidenceRule).mode === "required" }))
}
