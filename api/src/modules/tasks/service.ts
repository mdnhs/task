import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { TaskUpdate } from "@opsdesk/domain/contracts"
import { addDays, wallToEpoch } from "@opsdesk/domain/shifts"
import { can } from "@opsdesk/domain/permissions"
import { NO_EVIDENCE, normaliseRule, ruleError, type EvidenceRule } from "@opsdesk/domain/task-evidence"
import { diffFields, fieldLabel, type RawChange } from "@opsdesk/domain/task-history"
import { isOpen, nextStatuses } from "@opsdesk/domain/task-lifecycle"
import { STATUS, type TaskStatus } from "@opsdesk/domain/task-model"
import { taskStatusFor } from "@opsdesk/domain/shift-report"
import { AppError, Conflict, Forbidden } from "../../core/errors"
import { memberships, projectMilestones, roles, projects, taskHistory, taskTemplates, taskTimeEntries, tasks, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { decodeCursor, encodeCursor } from "../../core/cursor"
import { applyCompletion, evidenceFilter, settleCompletion } from "./evidence"
import { taskDtos, type CreateInput, type ListQueryInput, type PatchInput, type TaskDto } from "./dto"
import { publishTaskEvent, type TaskEvent } from "./events"
import { listHistory, recentHistory, writeHistory } from "./history"
import { changeRecipients, notifyTask, type TaskEnv } from "./notify"
import { allAssignees, assigneesOf, replaceAssignees } from "./repo"
import { canManage, getTask, taskScopeWhere, TaskNotFound, type TaskCtx, type TaskRow } from "./scope"
import { instantOfWall, wallOf } from "./time"

/** The two fields the lifecycle rules read, typed (archivedAt is a wall string there, only its presence matters). */
const lifecycleOf = (r: TaskRow) => ({ status: r.status as TaskStatus, archivedAt: r.archivedAt?.toISOString() })
export const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
export const OPEN_STATUSES: TaskStatus[] = ["not_started", "in_progress", "blocked", "submitted", "changes_requested"]

// ---------- validation helpers ----------

/** Ruling D17: trimmed, lower-cased, de-duplicated, at most 10, each 1–32 characters. */
export function normaliseLabels(input: string[]): string[] {
  const out = [...new Set(input.map((l) => l.trim().toLowerCase()))]
  if (out.some((l) => l.length < 1 || l.length > 32) || out.length > 10) throw unprocessable("invalid_labels")
  return out
}

export async function checkTeam(tx: TenantTx, ctx: TaskCtx, teamId: string | null | undefined): Promise<string | null> {
  if (!teamId) return null
  const [t] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), eq(teams.id, teamId), eq(teams.kind, "department")))
  if (!t) throw unprocessable("invalid_team") // another tenant's team, a plain team and a random id all look alike
  return t.id
}

/**
 * Assignees must be ACTIVE members of this tenant with tasks:read (a foreign, inactive or unknown id is the same 422 invalid_assignee) and distinct;
 * a team-scope manager may only pick themself or a direct report (422 assignee_out_of_scope, the same for any other id).
 */
export async function checkAssignees(tx: TenantTx, ctx: TaskCtx, primary: string, others: string[]): Promise<void> {
  const ids = [primary, ...others]
  if (new Set(ids).size !== ids.length) throw unprocessable("invalid_assignee")
  // Ruling E2: a team-scope manager assigns only themself or their direct reports; all-scope managers assign anyone.
  if (ctx.scope.kind === "team" && ids.some((id) => id !== ctx.me && !ctx.reports.includes(id))) throw unprocessable("assignee_out_of_scope")
  // An assignee must also hold tasks:read: otherwise they get the "New task" notice (with the title) and can never open the task.
  const rows = await tx
    .select({ u: memberships.userId, access: roles.access })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active"), inArray(memberships.userId, ids)))
  if (rows.length !== ids.length || rows.some((r) => !can({ access: r.access } as never, "tasks", "read"))) throw unprocessable("invalid_assignee")
}

/**
 * A rule the caller ENTERED (body, template, project, PUT /evidence-rule): judged strictly BEFORE it is normalised, so a Required rule with a
 * minimum of 0 or no types is refused (422 invalid_evidence_rule) instead of being quietly repaired. A named reviewer must be an ACTIVE member of
 * THIS tenant whose role has tasks:write (ruling E9: verify and reject need it, so a read-only reviewer could never act), else 422 invalid_reviewer (a person from another tenant looks exactly like an unknown one).
 */
export async function checkRule(tx: TenantTx, ctx: TaskCtx, rule: EvidenceRule | undefined): Promise<EvidenceRule> {
  if (!rule) return { ...NO_EVIDENCE }
  if (ruleError(rule)) throw unprocessable("invalid_evidence_rule")
  const r = normaliseRule(rule)
  if (ruleError(r)) throw unprocessable("invalid_evidence_rule")
  if (r.review === "named" && r.reviewer) {
    const [m] = await tx
      .select({ access: roles.access })
      .from(memberships)
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active"), eq(memberships.userId, r.reviewer)))
    if (!m || !can({ access: m.access } as never, "tasks", "write")) throw unprocessable("invalid_reviewer")
  }
  return r
}

const detail = async (tx: TenantTx, ctx: TaskCtx, row: TaskRow): Promise<TaskDto> => {
  const timeline = await recentHistory(tx, ctx, row.id)
  return (await taskDtos(tx, ctx, [row], new Map([[row.id, timeline]])))[0]
}

/**
 * The task, locked, with its assignees and the caller's relation to it. An archived task is 404 task_not_found like any hidden one, except for
 * `onArchived: "conflict"` (PATCH, assignees, status, complete): the caller can see the task, so the honest answer is 409 task_archived.
 */
export async function lockedTask(tx: TenantTx, ctx: TaskCtx, id: string, o: { onArchived?: "notFound" | "conflict" } = {}) {
  const row = await getTask(tx, ctx, id, { forUpdate: true, includeArchived: o.onArchived === "conflict" })
  if (row.archivedAt) throw Conflict("task_archived")
  const people = (await assigneesOf(tx, ctx.tenantId, [row.id])).get(row.id)!
  const assignees = allAssignees(people)
  return { row, people, assignees, manage: canManage(ctx, row, assignees), mine: assignees.includes(ctx.me) }
}

export const staleVersion = (row: TaskRow, version: number) => {
  if (row.version !== version) throw Conflict("version_conflict")
}

// ---------- create ----------

/**
 * The evidence rule a new task gets (ruling D23): the body's own rule, else the template's (`templateId`), else the project's default,
 * else NO_EVIDENCE. Only the RULE is inherited server-side; the other template fields are filled in by the client (applyTemplate). An
 * inherited rule whose named reviewer has left is kept but falls back to manager review, so a stale template never blocks creating a task.
 * A template of another tenant is the same 422 invalid_template as an unknown id.
 * Two documented consequences of D23: a template WITHOUT an evidence rule (its stored rule is NO_EVIDENCE) still beats the project's default, because the
 * explicit template wins; and since checkRule is strict, an inherited rule that is itself invalid (not just a departed reviewer) fails POST /v1/tasks with 422 invalid_evidence_rule.
 */
async function inheritedRule(tx: TenantTx, ctx: TaskCtx, body: EvidenceRule | undefined, templateId: string | undefined, projectRule: EvidenceRule | null): Promise<EvidenceRule> {
  if (body) return checkRule(tx, ctx, body)
  let from: EvidenceRule | null = projectRule
  if (templateId) {
    const [t] = await tx.select({ rule: taskTemplates.evidenceRule }).from(taskTemplates).where(and(eq(taskTemplates.tenantId, ctx.tenantId), eq(taskTemplates.id, templateId)))
    if (!t) throw unprocessable("invalid_template")
    from = t.rule
  }
  if (!from) return { ...NO_EVIDENCE }
  try {
    return await checkRule(tx, ctx, from)
  } catch (e) {
    if (e instanceof AppError && e.code === "invalid_reviewer") return checkRule(tx, ctx, { ...from, review: "manager", reviewer: undefined })
    throw e
  }
}

/**
 * POST /v1/tasks. The caller has already taken the ref (nextRefNo) and the actor lock (loadTaskCtx(…, "write")), in that order. A project
 * (and milestone) at creation is a manager's choice like in a PATCH (ruling D6): staff get 403 forbidden. The project row is locked FOR
 * SHARE after the ref counter and before the task row, the same order the recurrence job and PATCH use.
 */
export async function createTask(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, refNo: number, input: CreateInput): Promise<TaskDto> {
  const primary = input.primary ?? ctx.me
  const others = [...new Set(input.others)].sort()
  // Staff create tasks for themselves only (ruling D6): always 403, whether or not the other person exists.
  if (ctx.scope.kind === "own" && (primary !== ctx.me || others.length > 0)) throw Forbidden("cannot_assign_others")
  if (ctx.role.home !== "manager" && (input.projectId || input.milestoneId)) throw Forbidden("forbidden")
  const startAt = instantOfWall(input.start, ctx.tz)
  const dueAt = instantOfWall(input.due, ctx.tz)
  if (startAt.getTime() > dueAt.getTime()) throw unprocessable("invalid_dates")
  const labels = normaliseLabels(input.labels)
  const teamId = await checkTeam(tx, ctx, input.teamId)
  await checkAssignees(tx, ctx, primary, others)
  const place = { projectId: input.projectId ?? undefined, milestoneId: input.milestoneId ?? undefined }
  await lockPlacementTargets(tx, ctx, place)
  const { projectId, milestoneId } = await checkPlacement(tx, ctx, { projectId: null, milestoneId: null }, place)
  const [project] = projectId ? await tx.select({ rule: projects.defaultEvidenceRule }).from(projects).where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, projectId))) : []
  const evidenceRule = await inheritedRule(tx, ctx, input.evidenceRule as EvidenceRule | undefined, input.templateId, project?.rule ?? null)

  const [row] = await tx
    .insert(tasks)
    .values({
      tenantId: ctx.tenantId, refNo, title: input.title, description: input.description, teamId, creatorId: ctx.me, priority: input.priority, startAt, dueAt,
      labels, estimateMin: input.estimateMin ?? null, client: input.client ?? null, projectId, milestoneId, evidenceRule, overduePlan: input.overduePlan ?? null, createdAt: ctx.now, updatedAt: ctx.now,
    })
    .returning()
  await replaceAssignees(tx, ctx.tenantId, row.id, primary, others)
  const recipients = changeRecipients(ctx, row, [primary, ...others])
  await writeHistory(tx, ctx, row.id, { kind: "created", text: "Task created", notified: recipients })
  await notifyTask(tx, env, ctx, row, recipients, "New task")
  const dto = await detail(tx, ctx, row)
  await publishTaskEvent(tx, ctx, { type: "task.created", payload: { taskId: row.id, parentId: null, projectId, seriesId: null } })
  return dto
}

// ---------- read ----------

export async function getTaskDetail(tx: TenantTx, ctx: TaskCtx, id: string): Promise<TaskDto> {
  return detail(tx, ctx, await getTask(tx, ctx, id))
}

export { listHistory, detail as taskDetailDto }

const LIKE_ESCAPE = /[\\%_]/g

/**
 * Ruling S8, the ONE definition of "a task of team T": filed under the team OR assigned to one of its members. The list, the board, the calendar and the dashboard read models all use it, so a
 * dashboard number for a team equals the list it opens. It only narrows (the scope predicate is always applied beside it), so an unknown or unreachable team is just empty.
 */
export const teamTaskWhere = (teamId: string): SQL =>
  sql`(${tasks.teamId} = ${teamId}::uuid or exists (select 1 from task_assignees ta join team_members tm on tm.tenant_id = ta.tenant_id and tm.user_id = ta.user_id where ta.task_id = ${tasks.id} and tm.team_id = ${teamId}::uuid))`

/** The list filters as SQL conditions (ruling D5 scope, archived excluded); shared by the list and the board. */
export function listConditions(ctx: TaskCtx, f: Partial<ListQueryInput> & { after?: { at: Date; id: string } }): (SQL | undefined)[] {
  const conds: (SQL | undefined)[] = [eq(tasks.tenantId, ctx.tenantId), sql`${tasks.archivedAt} is null`, taskScopeWhere(ctx.scope, ctx.reports)]
  const mine = sql`exists (select 1 from task_assignees ta where ta.task_id = ${tasks.id} and ta.user_id = ${ctx.me})`
  if (f.status === "open") conds.push(inArray(tasks.status, OPEN_STATUSES))
  else if (f.status === "stuck") conds.push(sql`(${inArray(tasks.status, OPEN_STATUSES)} and (${tasks.status} = 'blocked' or ${tasks.dueAt} < ${ctx.now.toISOString()}::timestamptz))`)
  else if (f.status === "review") conds.push(sql`(${tasks.status} = 'submitted' and not ${mine})`)
  else if (f.status && f.status !== "all") conds.push(eq(tasks.status, f.status))
  if (f.due && f.due !== "all") {
    // Calendar days are the TENANT's (ruling D3): the day's bounds are wall-clock midnights converted to instants, so DST days are 23 or 25 hours long.
    const today = wallOf(ctx.now, ctx.tz).slice(0, 10)
    const at = (day: string) => new Date(wallToEpoch(`${day}T00:00:00`, ctx.tz)).toISOString()
    if (f.due === "today") conds.push(sql`(${tasks.dueAt} >= ${at(today)}::timestamptz and ${tasks.dueAt} < ${at(addDays(today, 1))}::timestamptz)`)
    else if (f.due === "week") conds.push(sql`(${tasks.dueAt} >= ${at(today)}::timestamptz and ${tasks.dueAt} < ${at(addDays(today, 8))}::timestamptz)`)
    else conds.push(sql`(${inArray(tasks.status, OPEN_STATUSES)} and ${tasks.dueAt} < ${ctx.now.toISOString()}::timestamptz)`)
  }
  if (f.priority) conds.push(eq(tasks.priority, Number(f.priority)))
  if (f.assignee) conds.push(sql`exists (select 1 from task_assignees ta where ta.task_id = ${tasks.id} and ta.user_id = ${f.assignee})`)
  // Ruling S8: filed under the department OR assigned to one of its members. It only narrows (the scope predicate above is untouched), so an unknown or unreachable team is just empty.
  if (f.teamId) conds.push(teamTaskWhere(f.teamId))
  if (f.project) conds.push(f.project === "none" ? sql`${tasks.projectId} is null` : eq(tasks.projectId, f.project))
  if (f.repeat) conds.push(sql`(${tasks.repeat} is not null or ${tasks.seriesId} is not null)`)
  if (f.label) conds.push(sql`${tasks.labels} @> array[${f.label.trim().toLowerCase()}]::text[]`)
  if (f.evidence) conds.push(evidenceFilter(f.evidence))
  if (f.ref) conds.push(eq(tasks.refNo, Number(f.ref.replace(/^tsk-/i, ""))))
  if (f.q) {
    const like = `%${f.q.toLowerCase().replace(LIKE_ESCAPE, (m) => `\\${m}`)}%`
    const asRef = /^(tsk-)?(\d{1,9})$/i.exec(f.q)
    conds.push(asRef ? sql`(${tasks.refNo} = ${Number(asRef[2])} or lower(${tasks.title}) like ${like})` : sql`lower(${tasks.title}) like ${like}`)
  }
  if (f.after) conds.push(sql`(${tasks.dueAt}, ${tasks.id}) > (${f.after.at.toISOString()}::timestamptz, ${f.after.id}::uuid)`)
  return conds
}

export function buildListQuery(tx: TenantTx, ctx: TaskCtx, f: Partial<ListQueryInput> & { after?: { at: Date; id: string } }, take: number) {
  return tx.select().from(tasks).where(and(...listConditions(ctx, f))).orderBy(asc(tasks.dueAt), asc(tasks.id)).limit(take)
}

export async function listTasks(tx: TenantTx, ctx: TaskCtx, q: ListQueryInput): Promise<{ items: TaskDto[]; nextCursor: string | null }> {
  const rows = await buildListQuery(tx, ctx, { ...q, after: q.cursor ? decodeCursor(q.cursor) : undefined }, q.limit + 1)
  const page = rows.slice(0, q.limit)
  const last = page[page.length - 1]
  return { items: await taskDtos(tx, ctx, page), nextCursor: rows.length > q.limit && last ? encodeCursor(last.dueAt, last.id) : null }
}

// ---------- update ----------

const STAFF_EDITABLE = ["title", "description", "priority", "labels"]

/**
 * A PATCH that links a task to a project or milestone first takes FOR SHARE on that project row, BEFORE the task row lock: project and
 * milestone writes lock the project row first and its tasks second, so both orders agree (no deadlock) and a project deleted meanwhile
 * is simply "not found" (422 invalid_project) instead of a foreign key error.
 */
async function lockPlacementTargets(tx: TenantTx, ctx: TaskCtx, input: Pick<PatchInput, "projectId" | "milestoneId">): Promise<void> {
  const ids = new Set<string>()
  if (input.projectId) ids.add(input.projectId)
  if (input.milestoneId) {
    const [m] = await tx.select({ p: projectMilestones.projectId }).from(projectMilestones).where(and(eq(projectMilestones.tenantId, ctx.tenantId), eq(projectMilestones.id, input.milestoneId)))
    if (m) ids.add(m.p)
  }
  if (ids.size) await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.tenantId, ctx.tenantId), inArray(projects.id, [...ids]))).orderBy(asc(projects.id)).for("share", { of: [projects] })
}

/**
 * The project and milestone a PATCH leaves the task in (managers only, enforced by the field whitelist above). A project must exist in this
 * tenant (422 invalid_project, the same for another tenant's id); the milestone must belong to the resulting project (422 invalid_milestone).
 * Moving to another project without naming a milestone drops the old milestone.
 */
async function checkPlacement(tx: TenantTx, ctx: TaskCtx, row: Pick<TaskRow, "projectId" | "milestoneId">, input: Pick<PatchInput, "projectId" | "milestoneId">): Promise<{ projectId: string | null; milestoneId: string | null }> {
  let projectId = row.projectId
  let milestoneId = row.milestoneId
  if (input.projectId === undefined && input.milestoneId === undefined) return { projectId, milestoneId }
  if (input.projectId !== undefined) {
    projectId = input.projectId
    if (projectId !== row.projectId && input.milestoneId === undefined) milestoneId = null
  }
  if (input.milestoneId !== undefined) milestoneId = input.milestoneId
  if (projectId && projectId !== row.projectId) {
    const [p] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.tenantId, ctx.tenantId), eq(projects.id, projectId)))
    if (!p) throw unprocessable("invalid_project")
  }
  if (milestoneId && (milestoneId !== row.milestoneId || projectId !== row.projectId)) {
    const [m] = projectId ? await tx.select({ id: projectMilestones.id }).from(projectMilestones).where(and(eq(projectMilestones.tenantId, ctx.tenantId), eq(projectMilestones.id, milestoneId), eq(projectMilestones.projectId, projectId))) : []
    if (!m) throw unprocessable("invalid_milestone")
  }
  if (milestoneId && !projectId) throw unprocessable("invalid_milestone")
  return { projectId, milestoneId }
}

/** PATCH /v1/tasks/{id}. Row lock → permission → version → validation → write → history → notify → publish. */
export async function patchTask(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: PatchInput): Promise<TaskDto> {
  await lockPlacementTargets(tx, ctx, input) // project row first, then the task row (the order project deletes use)
  const { row, assignees, manage, mine } = await lockedTask(tx, ctx, id, { onArchived: "conflict" })
  const touched = (Object.keys(input) as (keyof PatchInput)[]).filter((k) => k !== "version" && input[k] !== undefined)
  if (!manage) {
    if (touched.includes("start") || touched.includes("due")) throw Forbidden("dates_manager_only")
    const creator = row.creatorId === ctx.me
    // ruling D6: the creator fixes title, description, priority and labels; an assignee explains an overdue task
    if (!touched.every((f) => (STAFF_EDITABLE.includes(f) && creator) || (f === "overduePlan" && (mine || creator)))) throw Forbidden("forbidden")
  }
  staleVersion(row, input.version)

  const startAt = input.start ? instantOfWall(input.start, ctx.tz) : row.startAt
  const dueAt = input.due ? instantOfWall(input.due, ctx.tz) : row.dueAt
  if (startAt.getTime() > dueAt.getTime()) throw unprocessable("invalid_dates")
  const labels = input.labels ? normaliseLabels(input.labels) : row.labels
  const teamId = input.teamId === undefined ? row.teamId : await checkTeam(tx, ctx, input.teamId)
  const { projectId, milestoneId } = await checkPlacement(tx, ctx, row, input)
  const before = {
    title: row.title, description: row.description, priority: row.priority, labels: row.labels, estimateMin: row.estimateMin, client: row.client, teamId: row.teamId,
    start: row.startAt.toISOString(), due: row.dueAt.toISOString(), overduePlan: row.overduePlan, projectId: row.projectId, milestoneId: row.milestoneId,
  }
  const after = {
    title: input.title ?? row.title, description: input.description ?? row.description, priority: input.priority ?? row.priority, labels,
    estimateMin: input.estimateMin === undefined ? row.estimateMin : input.estimateMin, client: input.client === undefined ? row.client : input.client, teamId,
    start: startAt.toISOString(), due: dueAt.toISOString(), overduePlan: input.overduePlan === undefined ? row.overduePlan : input.overduePlan, projectId, milestoneId,
  }
  const changes = diffFields(before, after)
  if (changes.length === 0) return detail(tx, ctx, row) // nothing changed: no new version, no history line

  const datesMoved = changes.some((c) => c.field === "start" || c.field === "due")
  const [next] = await tx
    .update(tasks)
    .set({
      title: after.title, description: after.description, priority: after.priority, labels, estimateMin: after.estimateMin, client: after.client, teamId, startAt, dueAt,
      overduePlan: after.overduePlan, projectId, milestoneId, ...(datesMoved ? { proposal: null } : {}), version: row.version + 1, updatedAt: ctx.now,
    })
    .where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId)))
    .returning()
  const recipients = changeRecipients(ctx, row, assignees)
  const historyId = await writeHistory(tx, ctx, row.id, { kind: "updated", text: `Updated ${changes.map((c) => fieldLabel(c.field)).join(", ")}`, changes, notified: recipients })
  await notifyTask(tx, env, ctx, next, recipients, "Task updated")
  const dto = await detail(tx, ctx, next)
  await publishTaskEvent(tx, ctx, { type: "task.updated", payload: { taskId: row.id, historyId, fields: changes.map((c) => c.field) } })
  return dto
}

/** PUT /v1/tasks/{id}/assignees: managers only (ruling D6). Replaces the primary and the others. */
export async function setAssignees(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { version: number; primary: string; others: string[] }): Promise<TaskDto> {
  const { row, people, assignees, manage } = await lockedTask(tx, ctx, id, { onArchived: "conflict" })
  if (!manage) throw Forbidden("forbidden")
  staleVersion(row, input.version)
  const others = [...new Set(input.others)].sort()
  await checkAssignees(tx, ctx, input.primary, others)
  const from = allAssignees({ primary: people.primary, others: [...people.others].sort() })
  const to = [input.primary, ...others]
  const changes: RawChange[] = diffFields({ assignees: from }, { assignees: to })
  if (changes.length === 0) return detail(tx, ctx, row)
  const added = to.filter((u) => !assignees.includes(u))
  const removed = assignees.filter((u) => !to.includes(u))
  await replaceAssignees(tx, ctx.tenantId, row.id, input.primary, others)
  const [next] = await tx.update(tasks).set({ version: row.version + 1, updatedAt: ctx.now }).where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId))).returning()
  const recipients = changeRecipients(ctx, row, to, removed)
  await writeHistory(tx, ctx, row.id, { kind: "assigned", text: "Reassigned", changes, notified: recipients })
  await notifyTask(tx, env, ctx, next, recipients, "Task assignment changed")
  const dto = await detail(tx, ctx, next)
  await publishTaskEvent(tx, ctx, { type: "task.assigned", payload: { taskId: row.id, added, removed } })
  return dto
}

// ---------- status ----------

/** Sets the status and the moments that go with it (FR-M1-08: submitted/completed clear on any other move). */
function statusColumns(to: TaskStatus, at: Date) {
  return { status: to, submittedAt: to === "submitted" ? at : null, completedAt: to === "completed" ? at : null }
}

async function moveStatus(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, row: TaskRow, assignees: string[], to: TaskStatus, event: "status" | "completed" | "submitted"): Promise<TaskDto> {
  const [next] = await tx
    .update(tasks)
    .set({ ...statusColumns(to, ctx.now), version: row.version + 1, updatedAt: ctx.now })
    .where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId)))
    .returning()
  const from = row.status as TaskStatus
  // a submission is the reviewer's cue: the named reviewer (who sees the task through the rule) hears about it too
  const reviewer = to === "submitted" && row.evidenceRule.review === "named" && row.evidenceRule.reviewer ? [row.evidenceRule.reviewer] : []
  const recipients = changeRecipients(ctx, row, assignees, reviewer)
  await writeHistory(tx, ctx, row.id, { kind: "status", text: `Status changed ${STATUS[from].label} → ${STATUS[to].label}`, changes: [{ field: "status", from, to }], notified: recipients })
  await notifyTask(tx, env, ctx, next, recipients, "Task status changed")
  const dto = await detail(tx, ctx, next)
  if (event === "completed") await publishTaskEvent(tx, ctx, { type: "task.completed", payload: { taskId: row.id } })
  else if (event === "submitted") await publishTaskEvent(tx, ctx, { type: "task.submitted", payload: { taskId: row.id, round: row.round } })
  else await publishTaskEvent(tx, ctx, { type: "task.status_changed", payload: { taskId: row.id, from, to } })
  return dto
}

/** POST /v1/tasks/{id}/status: the assignee's moves (nextStatuses) and a manager's own moves plus cancel. "completed" is the complete route. */
export async function changeStatus(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { version: number; to: TaskStatus }): Promise<TaskDto> {
  const { row, assignees, manage, mine } = await lockedTask(tx, ctx, id, { onArchived: "conflict" })
  if (!manage && !mine) throw Forbidden("forbidden")
  staleVersion(row, input.version)
  if (input.to === "completed") return completeLocked(tx, env, ctx, row, assignees, manage, mine)
  const allowed = new Set<TaskStatus>([...nextStatuses(lifecycleOf(row), "assignee"), ...(manage ? nextStatuses(lifecycleOf(row), "reviewer").filter((s) => s === "cancelled") : [])])
  if (!allowed.has(input.to) || input.to === "submitted") throw unprocessable("invalid_transition")
  return moveStatus(tx, env, ctx, row, assignees, input.to, "status")
}

async function completeLocked(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, row: TaskRow, assignees: string[], manage: boolean, mine: boolean): Promise<TaskDto> {
  if (!manage && !mine) throw Forbidden("forbidden")
  if (!nextStatuses(lifecycleOf(row), "assignee").includes("completed")) throw unprocessable("invalid_transition")
  // the real items (ruling D10): a pending scan is 409 evidence_not_ready; only clean files count toward the minimum
  const settled = await settleCompletion(tx, ctx, row, { strict: true })
  if (settled.target === "blocked") throw unprocessable("evidence_required")
  await applyCompletion(tx, ctx, row, settled)
  return moveStatus(tx, env, ctx, row, assignees, settled.target, settled.target === "completed" ? "completed" : "submitted")
}

/** POST /v1/tasks/{id}/complete (FR-M1-43/44): "completed", or "submitted" when a reviewer must check, or 422 evidence_required. */
export async function completeTask(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { version: number }): Promise<TaskDto> {
  const { row, assignees, manage, mine } = await lockedTask(tx, ctx, id, { onArchived: "conflict" })
  if (!manage && !mine) throw Forbidden("forbidden")
  staleVersion(row, input.version)
  return completeLocked(tx, env, ctx, row, assignees, manage, mine)
}

// ---------- shift reports and the Today card (B5) ----------

const REF = /^TSK-(\d{1,9})$/

/**
 * A task change made outside /tasks (end-of-shift report FR-M1-26, Today card FR-M1-74), idempotent on `u.id`: a repeat is
 * "duplicate" and writes nothing. Status moves like taskStatusFor (never backwards); Done goes through completeTarget, so a Required
 * task without evidence stays open and gets the line "Report marked done; evidence still needed". Minutes are logged once per update id.
 * `o.events` collects the domain events instead of publishing them (the caller publishes them after its own audit entry). The caller names the person (ctx.me/actorId): the task must be in their scope and they must be an assignee or a manager of it, else 404 task_not_found. Archived tasks are skipped.
 */
export async function applyTaskUpdate(tx: TenantTx, ctx: TaskCtx, u: TaskUpdate, o: { events?: TaskEvent[] } = {}): Promise<"applied" | "duplicate" | "skipped_archived"> {
  const m = REF.exec(u.ref)
  if (!m) throw TaskNotFound()
  // Scope and authority first, and every refusal is the same 404 (an unknown ref, another person's task and a task you may not report on look alike).
  const [row] = await tx.select().from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), eq(tasks.refNo, Number(m[1])), taskScopeWhere(ctx.scope, ctx.reports))).for("update", { of: [tasks] })
  if (!row) throw TaskNotFound()
  const assignees = allAssignees((await assigneesOf(tx, ctx.tenantId, [row.id])).get(row.id)!)
  if (!assignees.includes(ctx.me) && !canManage(ctx, row, assignees)) throw TaskNotFound()
  const [dup] = await tx.select({ id: taskHistory.id }).from(taskHistory).where(and(eq(taskHistory.tenantId, ctx.tenantId), eq(taskHistory.taskId, row.id), eq(taskHistory.updateId, u.id)))
  if (dup) return "duplicate"
  if (row.archivedAt) return "skipped_archived"
  const at = instantOfWall(u.at, ctx.tz)
  const time = u.minutes > 0 ? `${u.minutes} min logged` : ""
  const from = `from the ${u.source}${u.note ? `: ${u.note}` : ""}`

  if (u.snooze) {
    await writeHistory(tx, ctx, row.id, { kind: "report", text: `Snoozed for today ${from}`, updateId: u.id })
    return "applied"
  }
  let status = row.status as TaskStatus
  let lead = "Reported"
  let historyId = u.id // the id the history line is filed under
  if (isOpen({ status })) {
    if (u.itemStatus === "done") {
      const settled = await settleCompletion(tx, ctx, row, { strict: false }) // a report never fails on a pending scan: that is just "evidence still needed"
      if (settled.target === "blocked") {
        lead = "Report marked done; evidence still needed"
        // H6: "evidence still needed" does NOT consume `u.id` (a later "done" after the upload must still complete the task): its line has its own id, and a repeat of it adds nothing
        historyId = `${u.id}#evidence`
        const [seen] = await tx.select({ id: taskHistory.id }).from(taskHistory).where(and(eq(taskHistory.tenantId, ctx.tenantId), eq(taskHistory.taskId, row.id), eq(taskHistory.updateId, historyId)))
        if (seen) return "applied"
      } else {
        status = settled.target
        await applyCompletion(tx, ctx, row, settled)
      }
    } else {
      status = taskStatusFor(u.itemStatus, status, false) as TaskStatus
    }
  }
  const moved = status !== row.status
  if (moved) lead = `Status set to ${STATUS[status].label}`
  if (moved) {
    await tx
      .update(tasks)
      .set({ ...statusColumns(status, at), version: row.version + 1, updatedAt: ctx.now })
      .where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId)))
  }
  if (u.minutes > 0) {
    await tx.insert(taskTimeEntries).values({ tenantId: ctx.tenantId, taskId: row.id, userId: ctx.me, minutes: u.minutes, note: u.note || `Time logged from the ${u.source}`, source: u.source, updateId: u.id, at }).onConflictDoNothing()
  }
  await writeHistory(tx, ctx, row.id, {
    kind: "report", text: [lead, time].filter(Boolean).join(", ") + ` ${from}`, changes: moved ? [{ field: "status", from: row.status, to: status }] : [], notified: [], updateId: historyId,
  })
  if (moved) {
    const event = status === "completed" ? ({ type: "task.completed", payload: { taskId: row.id } } as const)
      : status === "submitted" ? ({ type: "task.submitted", payload: { taskId: row.id, round: row.round } } as const)
      : ({ type: "task.status_changed", payload: { taskId: row.id, from: row.status as TaskStatus, to: status } } as const)
    if (o.events) o.events.push(event) // the caller publishes them LAST (a shift report submit records its audit entry first: the audit advisory lock before the relay-hint lock)
    else await publishTaskEvent(tx, ctx, event)
  }
  return "applied"
}
