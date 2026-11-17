import { and, asc, desc, eq, gte, inArray, isNotNull, lt, ne, sql, type SQL } from "drizzle-orm"
import { shiftReports, taskAssignees, taskComments, taskEvidence, tasks, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { buildListQuery, OPEN_STATUSES, taskScopeWhere, type TaskCtx } from "../tasks"
import { reportScopeWhere, type ReportCtx } from "../shift-reports"
import { dayBounds } from "./days"

// Every read-model statement is built here (so the EXPLAIN tests plan EXACTLY what runs). All of them are scoped by `taskScopeWhere` (ruling D5) or `reportScopeWhere` (F5): the same predicates as the
// task list and the report inbox, so a number here equals the list it opens. Archived tasks are never counted. No statement is per row: each aggregates in SQL or reads one bounded page.

const ts = (d: Date): string => d.toISOString()
const live = (ctx: Pick<TaskCtx, "tenantId">): SQL[] => [eq(tasks.tenantId, ctx.tenantId), sql`${tasks.archivedAt} is null`]
const iMine = (me: string): SQL => sql`exists (select 1 from ${taskAssignees} ta where ta.tenant_id = ${tasks.tenantId} and ta.task_id = ${tasks.id} and ta.user_id = ${me})`
const isOpen = inArray(tasks.status, OPEN_STATUSES)
const count = (where?: SQL) => (where ? sql<number>`count(*) filter (where ${where})::int` : sql<number>`count(*)::int`)

/** The open statuses a person still has to work on: not waiting on a reviewer, not blocked. An overdue task of these kinds is an "overdue" attention item (a blocked or submitted one has its own kind). */
const WORKING = ["not_started", "in_progress", "changes_requested"]

// ---------------------------------------------------------------- dashboard

/** open, overdue, due today, awaiting review (someone else's submitted task) and the status mix, in ONE pass over the scope's live tasks. `day` is the tenant-local day (its bounds are wall midnights, so a DST day is 23 or 25 h). */
export function dashboardSummaryQuery(tx: TenantTx, ctx: TaskCtx, day: string) {
  const { start, end } = dayBounds(day, ctx.tz)
  const now = sql`${ts(ctx.now)}::timestamptz`
  return tx
    .select({
      open: count(isOpen),
      overdue: count(sql`${isOpen} and ${tasks.dueAt} < ${now}`),
      dueToday: count(sql`${isOpen} and ${tasks.dueAt} >= ${ts(new Date(start))}::timestamptz and ${tasks.dueAt} < ${ts(new Date(end))}::timestamptz`),
      awaitingReview: count(sql`${tasks.status} = 'submitted' and not ${iMine(ctx.me)}`),
      notStarted: count(eq(tasks.status, "not_started")),
      inProgress: count(eq(tasks.status, "in_progress")),
      blocked: count(eq(tasks.status, "blocked")),
      submitted: count(eq(tasks.status, "submitted")),
      changesRequested: count(eq(tasks.status, "changes_requested")),
      completed: count(eq(tasks.status, "completed")),
      cancelled: count(eq(tasks.status, "cancelled")),
    })
    .from(tasks)
    .where(and(...live(ctx), taskScopeWhere(ctx.scope, ctx.reports)))
}

/** Evidence items waiting for a review decision on live tasks in scope (the gallery index `task_evidence_gallery_idx`: tenant, review, created_at, id). */
export function pendingEvidenceQuery(tx: TenantTx, ctx: TaskCtx) {
  return tx
    .select({ n: sql<number>`count(*)::int` })
    .from(taskEvidence)
    .innerJoin(tasks, and(eq(tasks.tenantId, taskEvidence.tenantId), eq(tasks.id, taskEvidence.taskId)))
    .where(and(eq(taskEvidence.tenantId, ctx.tenantId), eq(taskEvidence.review, "pending"), sql`${tasks.archivedAt} is null`, taskScopeWhere(ctx.scope, ctx.reports)))
}

/**
 * Completions per tenant-local day for `days` (consecutive, oldest first), grouped by bucket and primary assignee ("closer"): `tasks_closed_idx` for the window, then the scope. The bucket is the
 * index of the day whose [midnight, next midnight) holds the instant (`width_bucket` over the day-start instants), so a 23 h or 25 h day is exact. At most days × members rows.
 */
export function tasksClosedQuery(tx: TenantTx, ctx: TaskCtx, days: string[]) {
  const bounds = days.map((d) => dayBounds(d, ctx.tz))
  const edges = [...bounds.map((b) => b.start), bounds[bounds.length - 1].end].map((ms) => ms / 1000)
  if (!edges.every(Number.isFinite)) throw new Error("bad day bounds")
  const bucket = sql<number>`width_bucket(extract(epoch from ${tasks.completedAt})::float8, ${sql.raw(`array[${edges.join(",")}]::float8[]`)})::int`
  return tx
    .select({ bucket, userId: taskAssignees.userId, n: count(), late: count(sql`${tasks.completedAt} > ${tasks.dueAt}`) })
    .from(tasks)
    .leftJoin(taskAssignees, and(eq(taskAssignees.tenantId, tasks.tenantId), eq(taskAssignees.taskId, tasks.id), eq(taskAssignees.isPrimary, true)))
    .where(
      and(
        ...live(ctx), sql`${tasks.completedAt} is not null`, eq(tasks.status, "completed"),
        gte(tasks.completedAt, new Date(bounds[0].start)), lt(tasks.completedAt, new Date(bounds[bounds.length - 1].end)),
        taskScopeWhere(ctx.scope, ctx.reports),
      ),
    )
    .groupBy(sql`1`, taskAssignees.userId)
}

/** GET /v1/dashboard/team-tasks: the open tasks of the scope, due first: exactly the task list's `status=open` query (so the same rows, in the same order, with the same cursor). */
export const teamTasksQuery = (tx: TenantTx, ctx: TaskCtx, take: number, after?: { at: Date; id: string }) => buildListQuery(tx, ctx, { status: "open", after }, take)

// ---------------------------------------------------------------- attention

const ATTENTION_COLS = (tx: TenantTx) =>
  tx.select({ id: tasks.id, refNo: tasks.refNo, title: tasks.title, dueAt: tasks.dueAt, status: tasks.status, creatorId: tasks.creatorId })

/** Overdue (working statuses past their due time) or blocked tasks in scope, oldest due first. One task, one kind: submitted tasks are "evidence awaiting review", blocked ones are "blocked" even when late. */
export function attentionQuery(tx: TenantTx, ctx: TaskCtx, kind: "overdue" | "blocked", limit: number) {
  const where = kind === "blocked" ? eq(tasks.status, "blocked") : and(inArray(tasks.status, WORKING), sql`${tasks.dueAt} < ${ts(ctx.now)}::timestamptz`)
  return ATTENTION_COLS(tx)
    .from(tasks)
    .where(and(...live(ctx), where, taskScopeWhere(ctx.scope, ctx.reports)))
    .orderBy(asc(tasks.dueAt), asc(tasks.id))
    .limit(limit)
}

/** Submitted tasks that are NOT the caller's own (the list's `status=review`), with the number of evidence items still pending a decision (`task_evidence_task_idx`). */
export function awaitingReviewQuery(tx: TenantTx, ctx: TaskCtx, limit: number) {
  return tx
    .select({
      id: tasks.id, refNo: tasks.refNo, title: tasks.title, dueAt: tasks.dueAt, status: tasks.status, creatorId: tasks.creatorId,
      pending: sql<number>`(select count(*)::int from ${taskEvidence} e where e.tenant_id = ${tasks.tenantId} and e.task_id = ${tasks.id} and e.review = 'pending')`,
    })
    .from(tasks)
    .where(and(...live(ctx), eq(tasks.status, "submitted"), sql`not ${iMine(ctx.me)}`, taskScopeWhere(ctx.scope, ctx.reports)))
    .orderBy(asc(tasks.dueAt), asc(tasks.id))
    .limit(limit)
}

/** The exact size of each task kind in scope (the lists above are capped). The owner (primary assignee) of the rows is read for the page only, in one batch (assigneesOf). */
export function attentionCountsQuery(tx: TenantTx, ctx: TaskCtx) {
  return tx
    .select({
      overdue: count(sql`${inArray(tasks.status, WORKING)} and ${tasks.dueAt} < ${ts(ctx.now)}::timestamptz`),
      blocked: count(eq(tasks.status, "blocked")),
      review: count(sql`${tasks.status} = 'submitted' and not ${iMine(ctx.me)}`),
    })
    .from(tasks)
    .where(and(...live(ctx), inArray(tasks.status, ["not_started", "in_progress", "changes_requested", "blocked", "submitted"]), taskScopeWhere(ctx.scope, ctx.reports)))
}

// ---------------------------------------------------------------- reports (F5 scope)

/** Open reports (draft or returned) due on or after `since`, per team, with the next due time: `shift_reports_open_idx` (tenant, due_at) where status in ('draft','returned'). */
export function openReportsQuery(tx: TenantTx, ctx: ReportCtx, since: Date) {
  return tx
    .select({ teamId: shiftReports.teamId, open: sql<number>`count(*)::int`, nextDue: sql<Date | null>`min(${shiftReports.dueAt}) filter (where ${shiftReports.dueAt} >= ${ts(ctx.now)}::timestamptz)` })
    .from(shiftReports)
    .where(and(eq(shiftReports.tenantId, ctx.tenantId), sql`${shiftReports.status} in ('draft','returned')`, gte(shiftReports.dueAt, since), isNotNull(shiftReports.userId), reportScopeWhere(ctx)))
    .groupBy(shiftReports.teamId)
    .limit(100)
}

/** Submitted reports waiting for a review decision, shift date in [from, to]: `shift_reports_inbox_idx` (tenant, shift_date desc). */
export function awaitingReportsQuery(tx: TenantTx, ctx: ReportCtx, from: string, to: string) {
  return tx
    .select({ n: sql<number>`count(*)::int` })
    .from(shiftReports)
    .where(and(eq(shiftReports.tenantId, ctx.tenantId), gte(shiftReports.shiftDate, from), sql`${shiftReports.shiftDate} <= ${to}`, eq(shiftReports.status, "submitted"), isNotNull(shiftReports.userId), ne(shiftReports.userId, ctx.me), reportScopeWhere(ctx))) // not my own: review.ts refuses self_review
}

// ---------------------------------------------------------------- the member's own (staff dashboard, Today)

/** My open, overdue, waiting-for-review and returned counts: tasks I am an assignee of (`task_assignees_user_idx`). */
export function myCountsQuery(tx: TenantTx, tenantId: string, me: string, now: Date) {
  return tx
    .select({
      open: count(isOpen), overdue: count(sql`${isOpen} and ${tasks.dueAt} < ${ts(now)}::timestamptz`), review: count(eq(tasks.status, "submitted")), returned: count(eq(tasks.status, "changes_requested")),
    })
    .from(taskAssignees)
    .innerJoin(tasks, and(eq(tasks.tenantId, taskAssignees.tenantId), eq(tasks.id, taskAssignees.taskId)))
    .where(and(eq(taskAssignees.tenantId, tenantId), eq(taskAssignees.userId, me), sql`${tasks.archivedAt} is null`))
}

/** My open tasks, due first (bounded). */
export function myOpenTasksQuery(tx: TenantTx, tenantId: string, me: string, limit: number) {
  return tx
    .select({
      id: tasks.id, refNo: tasks.refNo, title: tasks.title, priority: tasks.priority, status: tasks.status, dueAt: tasks.dueAt, evidenceRule: tasks.evidenceRule, client: tasks.client, teamName: teams.name,
    })
    .from(taskAssignees)
    .innerJoin(tasks, and(eq(tasks.tenantId, taskAssignees.tenantId), eq(tasks.id, taskAssignees.taskId)))
    .leftJoin(teams, and(eq(teams.tenantId, tasks.tenantId), eq(teams.id, tasks.teamId)))
    .where(and(eq(taskAssignees.tenantId, tenantId), eq(taskAssignees.userId, me), sql`${tasks.archivedAt} is null`, inArray(tasks.status, OPEN_STATUSES)))
    .orderBy(asc(tasks.dueAt), asc(tasks.id))
    .limit(limit)
}

/** The latest comments by other people on tasks I am an assignee of (live tasks, not deleted comments). */
export function myCommentsQuery(tx: TenantTx, tenantId: string, me: string, limit: number) {
  return tx
    .select({ id: taskComments.id, taskId: tasks.id, refNo: tasks.refNo, taskTitle: tasks.title, authorId: taskComments.authorId, body: taskComments.body, at: taskComments.createdAt })
    .from(taskAssignees)
    .innerJoin(tasks, and(eq(tasks.tenantId, taskAssignees.tenantId), eq(tasks.id, taskAssignees.taskId)))
    .innerJoin(taskComments, and(eq(taskComments.tenantId, tasks.tenantId), eq(taskComments.taskId, tasks.id)))
    .where(and(eq(taskAssignees.tenantId, tenantId), eq(taskAssignees.userId, me), sql`${tasks.archivedAt} is null`, sql`${taskComments.deletedAt} is null`, sql`${taskComments.authorId} is distinct from ${me}`))
    .orderBy(desc(taskComments.createdAt), desc(taskComments.id))
    .limit(limit)
}

/** Others' overdue open tasks in scope (the manager's team line): the exact count and the worst `limit`, worst first (priority, then longest overdue, then ref). */
export function teamOverdueQuery(tx: TenantTx, ctx: TaskCtx, limit: number) {
  return tx
    .select({
      id: tasks.id, refNo: tasks.refNo, title: tasks.title, priority: tasks.priority, status: tasks.status, dueAt: tasks.dueAt, total: sql<number>`count(*) over ()::int`,
    })
    .from(tasks)
    .where(and(...live(ctx), isOpen, sql`${tasks.dueAt} < ${ts(ctx.now)}::timestamptz`, sql`not ${iMine(ctx.me)}`, taskScopeWhere(ctx.scope, ctx.reports)))
    .orderBy(desc(tasks.priority), asc(tasks.dueAt), asc(tasks.refNo))
    .limit(limit)
}
