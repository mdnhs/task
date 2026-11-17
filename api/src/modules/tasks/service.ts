import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm"
import type { TaskUpdate } from "@opsdesk/domain/contracts"
import { addDays, wallToEpoch } from "@opsdesk/domain/shifts"
import { completeTarget, NO_EVIDENCE, normaliseRule, ruleError, type EvidenceRule } from "@opsdesk/domain/task-evidence"
import { diffFields, fieldLabel, type RawChange } from "@opsdesk/domain/task-history"
import { isOpen, nextStatuses } from "@opsdesk/domain/task-lifecycle"
import { STATUS, type TaskStatus } from "@opsdesk/domain/task-model"
import { taskStatusFor } from "@opsdesk/domain/shift-report"
import { AppError, Conflict, Forbidden } from "../../core/errors"
import { memberships, taskHistory, taskTimeEntries, tasks, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { decodeCursor, encodeCursor } from "./cursor"
import { taskDtos, type CreateInput, type ListQueryInput, type PatchInput, type TaskDto } from "./dto"
import { publishTaskEvent } from "./events"
import { listHistory, recentHistory, writeHistory } from "./history"
import { changeRecipients, notifyTask, type TaskEnv } from "./notify"
import { allAssignees, assigneesOf, replaceAssignees } from "./repo"
import { canManage, getTask, taskScopeWhere, TaskNotFound, type TaskCtx, type TaskRow } from "./scope"
import { instantOfWall, wallOf } from "./time"

/** The two fields the lifecycle rules read, typed (archivedAt is a wall string there, only its presence matters). */
const lifecycleOf = (r: TaskRow) => ({ status: r.status as TaskStatus, archivedAt: r.archivedAt?.toISOString() })
const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const OPEN_STATUSES: TaskStatus[] = ["not_started", "in_progress", "blocked", "submitted", "changes_requested"]

// ---------- validation helpers ----------

/** Ruling D17: trimmed, lower-cased, de-duplicated, at most 10, each 1–32 characters. */
export function normaliseLabels(input: string[]): string[] {
  const out = [...new Set(input.map((l) => l.trim().toLowerCase()))]
  if (out.some((l) => l.length < 1 || l.length > 32) || out.length > 10) throw unprocessable("invalid_labels")
  return out
}

async function checkTeam(tx: TenantTx, ctx: TaskCtx, teamId: string | null | undefined): Promise<string | null> {
  if (!teamId) return null
  const [t] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), eq(teams.id, teamId), eq(teams.kind, "department")))
  if (!t) throw unprocessable("invalid_team") // another tenant's team, a plain team and a random id all look alike
  return t.id
}

/**
 * Assignees must be ACTIVE members of this tenant (a foreign, inactive or unknown id is the same 422 invalid_assignee) and distinct;
 * a team-scope manager may only pick themself or a direct report (422 assignee_out_of_scope, the same for any other id).
 */
async function checkAssignees(tx: TenantTx, ctx: TaskCtx, primary: string, others: string[]): Promise<void> {
  const ids = [primary, ...others]
  if (new Set(ids).size !== ids.length) throw unprocessable("invalid_assignee")
  // Ruling E2: a team-scope manager assigns only themself or their direct reports; all-scope managers assign anyone.
  if (ctx.scope.kind === "team" && ids.some((id) => id !== ctx.me && !ctx.reports.includes(id))) throw unprocessable("assignee_out_of_scope")
  const rows = await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active"), inArray(memberships.userId, ids)))
  if (rows.length !== ids.length) throw unprocessable("invalid_assignee")
}

async function checkRule(tx: TenantTx, ctx: TaskCtx, rule: EvidenceRule | undefined): Promise<EvidenceRule> {
  if (!rule) return { ...NO_EVIDENCE }
  const r = normaliseRule(rule)
  if (ruleError(r)) throw unprocessable("invalid_evidence_rule")
  if (r.review === "named" && r.reviewer) {
    const [m] = await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active"), eq(memberships.userId, r.reviewer)))
    if (!m) throw unprocessable("invalid_reviewer")
  }
  return r
}

const detail = async (tx: TenantTx, ctx: TaskCtx, row: TaskRow): Promise<TaskDto> => {
  const timeline = await recentHistory(tx, ctx, row.id)
  return (await taskDtos(tx, ctx, [row], new Map([[row.id, timeline]])))[0]
}

async function lockedTask(tx: TenantTx, ctx: TaskCtx, id: string) {
  const row = await getTask(tx, ctx, id, { forUpdate: true })
  const people = (await assigneesOf(tx, ctx.tenantId, [row.id])).get(row.id)!
  const assignees = allAssignees(people)
  return { row, people, assignees, manage: canManage(ctx, row, assignees), mine: assignees.includes(ctx.me) }
}

const staleVersion = (row: TaskRow, version: number) => {
  if (row.version !== version) throw Conflict("version_conflict")
}

// ---------- create ----------

/** POST /v1/tasks. The caller has already taken the ref (nextRefNo) and the actor lock (loadTaskCtx(…, "write")), in that order. */
export async function createTask(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, refNo: number, input: CreateInput): Promise<TaskDto> {
  const primary = input.primary ?? ctx.me
  const others = [...new Set(input.others)].sort()
  // Staff create tasks for themselves only (ruling D6): always 403, whether or not the other person exists.
  if (ctx.scope.kind === "own" && (primary !== ctx.me || others.length > 0)) throw Forbidden("cannot_assign_others")
  const startAt = instantOfWall(input.start, ctx.tz)
  const dueAt = instantOfWall(input.due, ctx.tz)
  if (startAt.getTime() > dueAt.getTime()) throw unprocessable("invalid_dates")
  const labels = normaliseLabels(input.labels)
  const teamId = await checkTeam(tx, ctx, input.teamId)
  await checkAssignees(tx, ctx, primary, others)
  const evidenceRule = await checkRule(tx, ctx, input.evidenceRule as EvidenceRule | undefined)

  const [row] = await tx
    .insert(tasks)
    .values({
      tenantId: ctx.tenantId, refNo, title: input.title, description: input.description, teamId, creatorId: ctx.me, priority: input.priority, startAt, dueAt,
      labels, estimateMin: input.estimateMin ?? null, client: input.client ?? null, evidenceRule, overduePlan: input.overduePlan ?? null, createdAt: ctx.now, updatedAt: ctx.now,
    })
    .returning()
  await replaceAssignees(tx, ctx.tenantId, row.id, primary, others)
  const recipients = changeRecipients(ctx, row, [primary, ...others])
  await writeHistory(tx, ctx, row.id, { kind: "created", text: "Task created", notified: recipients })
  await notifyTask(tx, env, ctx, row, recipients, "New task")
  const dto = await detail(tx, ctx, row)
  await publishTaskEvent(tx, ctx, { type: "task.created", payload: { taskId: row.id, parentId: null, projectId: null, seriesId: null } })
  return dto
}

// ---------- read ----------

export async function getTaskDetail(tx: TenantTx, ctx: TaskCtx, id: string): Promise<TaskDto> {
  return detail(tx, ctx, await getTask(tx, ctx, id))
}

export { listHistory }

const LIKE_ESCAPE = /[\\%_]/g

/** The list query (ruling D5 scope, archived excluded, cursor on (due_at, id)); exported so the EXPLAIN test can plan the exact statement. */
export function buildListQuery(tx: TenantTx, ctx: TaskCtx, f: Partial<ListQueryInput> & { after?: { at: Date; id: string } }, take: number) {
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
  if (f.project) conds.push(f.project === "none" ? sql`${tasks.projectId} is null` : eq(tasks.projectId, f.project))
  if (f.repeat) conds.push(sql`(${tasks.repeat} is not null or ${tasks.seriesId} is not null)`)
  if (f.label) conds.push(sql`${tasks.labels} @> array[${f.label.trim().toLowerCase()}]::text[]`)
  if (f.ref) conds.push(eq(tasks.refNo, Number(f.ref.replace(/^tsk-/i, ""))))
  if (f.q) {
    const like = `%${f.q.toLowerCase().replace(LIKE_ESCAPE, (m) => `\\${m}`)}%`
    const asRef = /^(tsk-)?(\d{1,9})$/i.exec(f.q)
    conds.push(asRef ? sql`(${tasks.refNo} = ${Number(asRef[2])} or lower(${tasks.title}) like ${like})` : sql`lower(${tasks.title}) like ${like}`)
  }
  if (f.after) conds.push(sql`(${tasks.dueAt}, ${tasks.id}) > (${f.after.at.toISOString()}::timestamptz, ${f.after.id}::uuid)`)
  return tx.select().from(tasks).where(and(...conds)).orderBy(asc(tasks.dueAt), asc(tasks.id)).limit(take)
}

export async function listTasks(tx: TenantTx, ctx: TaskCtx, q: ListQueryInput): Promise<{ items: TaskDto[]; nextCursor: string | null }> {
  const rows = await buildListQuery(tx, ctx, { ...q, after: q.cursor ? decodeCursor(q.cursor) : undefined }, q.limit + 1)
  const page = rows.slice(0, q.limit)
  const last = page[page.length - 1]
  return { items: await taskDtos(tx, ctx, page), nextCursor: rows.length > q.limit && last ? encodeCursor(last.dueAt, last.id) : null }
}

// ---------- update ----------

const STAFF_EDITABLE = ["title", "description", "priority", "labels"]

/** PATCH /v1/tasks/{id}. Row lock → permission → version → validation → write → history → notify → publish. */
export async function patchTask(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: PatchInput): Promise<TaskDto> {
  const { row, assignees, manage, mine } = await lockedTask(tx, ctx, id)
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
  const before = {
    title: row.title, description: row.description, priority: row.priority, labels: row.labels, estimateMin: row.estimateMin, client: row.client, teamId: row.teamId,
    start: row.startAt.toISOString(), due: row.dueAt.toISOString(), overduePlan: row.overduePlan,
  }
  const after = {
    title: input.title ?? row.title, description: input.description ?? row.description, priority: input.priority ?? row.priority, labels,
    estimateMin: input.estimateMin === undefined ? row.estimateMin : input.estimateMin, client: input.client === undefined ? row.client : input.client, teamId,
    start: startAt.toISOString(), due: dueAt.toISOString(), overduePlan: input.overduePlan === undefined ? row.overduePlan : input.overduePlan,
  }
  const changes = diffFields(before, after)
  if (changes.length === 0) return detail(tx, ctx, row) // nothing changed: no new version, no history line

  const datesMoved = changes.some((c) => c.field === "start" || c.field === "due")
  const [next] = await tx
    .update(tasks)
    .set({
      title: after.title, description: after.description, priority: after.priority, labels, estimateMin: after.estimateMin, client: after.client, teamId, startAt, dueAt,
      overduePlan: after.overduePlan, ...(datesMoved ? { proposal: null } : {}), version: row.version + 1, updatedAt: ctx.now,
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
  const { row, people, assignees, manage } = await lockedTask(tx, ctx, id)
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
  const recipients = changeRecipients(ctx, row, assignees)
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
  const { row, assignees, manage, mine } = await lockedTask(tx, ctx, id)
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
  const target = completeTarget(row.evidenceRule, []) // evidence items arrive with T4.6: until then a Required task cannot be completed
  if (target === "blocked") throw unprocessable("evidence_required")
  return moveStatus(tx, env, ctx, row, assignees, target, target === "completed" ? "completed" : "submitted")
}

/** POST /v1/tasks/{id}/complete (FR-M1-43/44): "completed", or "submitted" when a reviewer must check, or 422 evidence_required. */
export async function completeTask(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { version: number }): Promise<TaskDto> {
  const { row, assignees, manage, mine } = await lockedTask(tx, ctx, id)
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
 * The caller names the person (ctx.me/actorId): the task must be in their scope and they must be an assignee or a manager of it, else 404 task_not_found. Archived tasks are skipped.
 */
export async function applyTaskUpdate(tx: TenantTx, ctx: TaskCtx, u: TaskUpdate): Promise<"applied" | "duplicate" | "skipped_archived"> {
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
  if (isOpen({ status })) {
    if (u.itemStatus === "done") {
      const target = completeTarget(row.evidenceRule, [])
      if (target === "blocked") lead = "Report marked done; evidence still needed"
      else status = target
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
    await tx.insert(taskTimeEntries).values({ tenantId: ctx.tenantId, taskId: row.id, userId: ctx.me, minutes: u.minutes, note: u.note, source: u.source, updateId: u.id, at }).onConflictDoNothing()
  }
  await writeHistory(tx, ctx, row.id, {
    kind: "report", text: [lead, time].filter(Boolean).join(", ") + ` ${from}`, changes: moved ? [{ field: "status", from: row.status, to: status }] : [], notified: [], updateId: u.id,
  })
  if (moved) {
    const event = status === "completed" ? ({ type: "task.completed", payload: { taskId: row.id } } as const)
      : status === "submitted" ? ({ type: "task.submitted", payload: { taskId: row.id, round: row.round } } as const)
      : ({ type: "task.status_changed", payload: { taskId: row.id, from: row.status as TaskStatus, to: status } } as const)
    await publishTaskEvent(tx, ctx, event)
  }
  return "applied"
}
