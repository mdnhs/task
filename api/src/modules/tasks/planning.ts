import { createHash } from "node:crypto"
import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { z } from "@hono/zod-openapi"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { can } from "@opsdesk/domain/permissions"
import { diffFields } from "@opsdesk/domain/task-history"
import { KnockOnTooLarge, knockOn, wouldCycle, type PlanTask } from "@opsdesk/domain/task-planning"
import { AppError, Conflict, Forbidden } from "../../core/errors"
import type { ResolvedRole } from "../../core/context"
import { memberships, reportingLines, roles, taskDependencies, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { effectiveReportScope } from "../teams"
import { Version, Wall, type TaskDto } from "./dto"
import { publishTaskEvent } from "./events"
import { writeHistory } from "./history"
import { changeRecipients, notifyTask, type TaskEnv } from "./notify"
import { allAssignees, assigneesOf } from "./repo"
import { canManage, getTask, inScope, taskScopeWhere, TaskNotFound, type TaskCtx, type TaskRow } from "./scope"
import { lockedTask, staleVersion, taskDetailDto } from "./service"
import { formatDateTime } from "@opsdesk/domain/dates"
import { instantOfWall, wallOf } from "./time"

// Dependencies, knock-on reschedule and date proposals (FR-M1-02, FR-M1-14, Q8). Every mutation here is a manager's (or, for a
// proposal, an assignee's) write to task fields, so it checks and bumps `version` (ruling D4). Lock order: the task-graph advisory lock
// (run.ts mutate({ graphLock })) → actor lock → task rows FOR UPDATE sorted by id → writes → history → notify → publish.

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const START_EX = "2026-11-20T09:00:00"
const HASH_EX = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"

// ---------- request bodies and responses (R5: every JSON body declares an example) ----------

export const DependenciesBody = z.object({ version: Version, dependsOnIds: z.array(z.uuid()).max(20) }).openapi({ example: { version: 1, dependsOnIds: [TID] } })
const KnockOn = z
  .object({ apply: z.boolean(), previewHash: z.string().length(64).optional() })
  .refine((k) => !k.apply || !!k.previewHash)
  .openapi({ description: "apply:true moves the dependants shown by the preview (previewHash required); apply:false moves only this task", example: { apply: true, previewHash: HASH_EX } })
export const PreviewBody = z.object({ start: Wall, due: Wall }).openapi({ example: { start: START_EX, due: "2026-11-22T17:00:00" } })
export const RescheduleBody = z
  .object({ version: Version, start: Wall, due: Wall, reason: z.string().trim().max(500).optional(), knockOn: KnockOn })
  .openapi({ example: { version: 1, start: START_EX, due: "2026-11-22T17:00:00", reason: "Waiting on the supplier", knockOn: { apply: false } } })
export const ProposeBody = z
  .object({ start: Wall, due: Wall, reason: z.string().trim().min(1).max(500) })
  .openapi({ example: { start: START_EX, due: "2026-11-22T17:00:00", reason: "The delivery is late" } })
export const ApproveBody = z.object({ version: Version, knockOn: KnockOn }).openapi({ example: { version: 1, knockOn: { apply: false } } })
export const DeclineBody = z.object({ version: Version, reason: z.string().trim().max(500).optional() }).openapi({ example: { version: 1, reason: "Not possible this week" } })

const Moved = z.object({
  taskId: z.uuid(), ref: z.string(), title: z.string(), from: z.object({ start: z.string(), due: z.string() }), to: z.object({ start: z.string(), due: z.string() }), outOfScope: z.literal(false),
})
const Hidden = z.object({ outOfScope: z.literal(true) }).openapi({ description: "A task outside the caller's scope: nothing about it is shown, only that it would move" })
export const PreviewSchema = z
  .object({ moves: z.array(z.union([Moved, Hidden])), hiddenMoves: z.number().int(), previewHash: z.string() })
  .openapi({ example: { moves: [{ taskId: TID, ref: "TSK-1001", title: "Paint the hall", from: { start: "2026-11-21T09:00:00", due: "2026-11-21T17:00:00" }, to: { start: "2026-11-23T09:00:00", due: "2026-11-23T17:00:00" }, outOfScope: false }, { outOfScope: true }], hiddenMoves: 1, previewHash: HASH_EX } })
export type RescheduleInput = z.infer<typeof RescheduleBody>
type KnockOnInput = z.infer<typeof KnockOn>

const full = (w: string) => (w.length === 16 ? `${w}:00` : w)
const ref = (n: number) => `TSK-${n}`
const detail = taskDetailDto

// ---------- dependencies ----------

/** PUT /v1/tasks/{id}/dependencies: replaces the edges the caller can see (the caller holds the graph lock). */
export async function setDependencies(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { version: number; dependsOnIds: string[] }): Promise<TaskDto> {
  const { row, assignees, manage } = await lockedTask(tx, ctx, id)
  if (!manage) throw Forbidden("forbidden")
  staleVersion(row, input.version)
  const wanted = [...new Set(input.dependsOnIds)]
  if (wanted.includes(row.id)) throw unprocessable("dependency_cycle") // a task cannot depend on itself
  // Every id must be a live task of this tenant inside the caller's scope: another tenant's, an archived one, one the caller may not
  // see and a random id are all the same 422 (no existence oracle).
  const visibleFor = async (ids: string[]) =>
    ids.length === 0
      ? []
      : await tx.select({ id: tasks.id, refNo: tasks.refNo }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, ids), sql`${tasks.archivedAt} is null`, taskScopeWhere(ctx.scope, ctx.reports)))
  const found = await visibleFor(wanted)
  if (found.length !== wanted.length) throw unprocessable("invalid_dependency")
  const edges = await tx.select({ taskId: taskDependencies.taskId, on: taskDependencies.dependsOnId }).from(taskDependencies).where(eq(taskDependencies.tenantId, ctx.tenantId))
  const mine = edges.filter((e) => e.taskId === row.id).map((e) => e.on)
  const seen = new Map((await visibleFor(mine)).map((t) => [t.id, t.refNo]))
  // Ruling E5: the edges a replace keeps without being asked are only those to LIVE tasks outside the caller's scope (they cannot see or
  // name them). Edges to ARCHIVED tasks are dropped by every PUT, so a dependency on an archived task can always be removed. The cycle
  // check below still looks at every edge of the tenant, archived tasks included, while an edge exists.
  const live = mine.length ? new Set((await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, mine), sql`${tasks.archivedAt} is null`))).map((t) => t.id)) : new Set<string>()
  const hidden = mine.filter((m) => live.has(m) && !seen.has(m))
  const next = [...wanted, ...hidden]
  if (next.length > 20) throw unprocessable("invalid_dependency") // the cap of 20 covers the kept hidden edges too
  // Cycle check over EVERY edge of the tenant (archived tasks included: a restore must never close a loop), with this task's own edges replaced.
  const others = new Map<string, string[]>()
  for (const e of edges) if (e.taskId !== row.id) others.set(e.taskId, [...(others.get(e.taskId) ?? []), e.on])
  const nodes = [...others].map(([r, dependsOn]) => ({ ref: r, dependsOn }))
  if (next.some((on) => wouldCycle(nodes, row.id, on))) throw unprocessable("dependency_cycle")

  const refsOf = (m: Map<string, number>, ids: string[]) => ids.filter((i) => m.has(i)).map((i) => ref(m.get(i)!)).sort()
  const fromRefs = refsOf(seen, mine)
  const toMap = new Map(found.map((t) => [t.id, t.refNo]))
  const toRefs = refsOf(toMap, wanted)
  const changes = diffFields({ dependsOn: fromRefs }, { dependsOn: toRefs })
  const droppedArchived = mine.some((m) => !next.includes(m) && !seen.has(m))
  if (changes.length === 0 && !droppedArchived) return detail(tx, ctx, row)
  await tx.delete(taskDependencies).where(and(eq(taskDependencies.tenantId, ctx.tenantId), eq(taskDependencies.taskId, row.id)))
  if (next.length) await tx.insert(taskDependencies).values(next.map((on) => ({ tenantId: ctx.tenantId, taskId: row.id, dependsOnId: on })))
  const [updated] = await tx.update(tasks).set({ version: row.version + 1, updatedAt: ctx.now }).where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId))).returning()
  const recipients = changeRecipients(ctx, row, assignees)
  const historyId = await writeHistory(tx, ctx, row.id, { kind: "updated", text: "Updated Depends on", changes, notified: recipients })
  await notifyTask(tx, env, ctx, updated, recipients, "Task dependencies changed")
  const dto = await detail(tx, ctx, updated)
  await publishTaskEvent(tx, ctx, { type: "task.updated", payload: { taskId: row.id, historyId, fields: ["dependsOn"] } })
  return dto
}

// ---------- knock-on ----------

type PlannedMove = { taskId: string; ref: string; title: string; from: { start: string; due: string }; to: { start: string; due: string }; outOfScope: boolean; version: number }
type Plan = { root: TaskRow; rows: Map<string, TaskRow>; moves: PlannedMove[]; previewHash: string; rootAssignees: string[]; people: Map<string, string[]> }

/** The task and every task that (transitively) depends on it. UNION ends the walk on a loop; the edge index is task_deps_on_idx. */
async function downstream(tx: TenantTx, tenantId: string, rootId: string): Promise<string[]> {
  const res = await tx.execute(sql`with recursive d(id) as (select ${rootId}::uuid union select e.task_id from task_dependencies e join d on e.depends_on_id = d.id where e.tenant_id = ${tenantId}::uuid) select id from d`)
  return (res.rows as { id: string }[]).map((r) => r.id)
}

/**
 * What moving `rootId` to `to` (wall clock) does. With `withMoves` the whole downstream set is read (and with `lock`, locked FOR UPDATE in id
 * order, the one deterministic order); archived tasks are left out, so they are never moved and never pushed through. The preview hash covers
 * the target dates, every move and the version of each moved task: what is applied is what was shown (ruling D20).
 */
async function plan(tx: TenantTx, ctx: TaskCtx, rootId: string, to: { start: string; due: string }, o: { withMoves: boolean; lock: boolean }): Promise<Plan> {
  const ids = o.withMoves ? await downstream(tx, ctx.tenantId, rootId) : [rootId]
  const q = tx.select().from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, ids))).orderBy(asc(tasks.id))
  const rows = o.lock ? await q.for("update", { of: [tasks] }) : await q
  const live = rows.filter((r) => !r.archivedAt)
  const root = live.find((r) => r.id === rootId)
  if (!root) throw TaskNotFound()
  const edges = o.withMoves && live.length > 1 ? await tx.select({ taskId: taskDependencies.taskId, on: taskDependencies.dependsOnId }).from(taskDependencies).where(and(eq(taskDependencies.tenantId, ctx.tenantId), inArray(taskDependencies.taskId, live.map((r) => r.id)))) : []
  const nodes: PlanTask[] = live.map((r) => ({
    ref: r.id, title: r.title, start: wallOf(r.startAt, ctx.tz), due: wallOf(r.dueAt, ctx.tz), status: r.status, dependsOn: edges.filter((e) => e.taskId === r.id).map((e) => e.on),
  }))
  let raw: ReturnType<typeof knockOn> = []
  if (o.withMoves) {
    try {
      raw = knockOn(nodes, rootId, to)
    } catch (e) {
      if (e instanceof KnockOnTooLarge) throw unprocessable("knock_on_too_large")
      throw e
    }
  }
  const people = new Map<string, string[]>()
  const byId = new Map(live.map((r) => [r.id, r]))
  const assigned = await assigneesOf(tx, ctx.tenantId, [rootId, ...raw.map((m) => m.ref)])
  for (const [k, v] of assigned) people.set(k, allAssignees(v))
  const moves: PlannedMove[] = raw
    .map((m) => {
      const r = byId.get(m.ref)!
      return { taskId: r.id, ref: ref(r.refNo), title: m.title, from: m.from, to: m.to, outOfScope: !inScope(ctx, r, people.get(r.id) ?? []), version: r.version }
    })
    .sort((a, b) => (a.taskId < b.taskId ? -1 : 1))
  const previewHash = createHash("sha256")
    .update(JSON.stringify({ root: rootId, start: to.start, due: to.due, moves: moves.map((m) => [m.taskId, m.from, m.to, m.version]) }))
    .digest("hex")
  return { root, rows: byId, moves, previewHash, rootAssignees: people.get(rootId) ?? [], people }
}

const checkRange = (ctx: TaskCtx, start: string, due: string) => {
  if (instantOfWall(start, ctx.tz).getTime() > instantOfWall(due, ctx.tz).getTime()) throw unprocessable("invalid_dates")
}

/** POST /v1/tasks/{id}/reschedule/preview: the dependants a reschedule would push (nothing is written, nothing locked). Managers only. */
export async function previewReschedule(tx: TenantTx, ctx: TaskCtx, id: string, input: { start: string; due: string }): Promise<z.infer<typeof PreviewSchema>> {
  const row = await getTask(tx, ctx, id)
  const a = allAssignees((await assigneesOf(tx, ctx.tenantId, [row.id])).get(row.id)!)
  if (!canManage(ctx, row, a)) throw Forbidden("dates_manager_only")
  const to = { start: full(input.start), due: full(input.due) }
  checkRange(ctx, to.start, to.due)
  const p = await plan(tx, ctx, id, to, { withMoves: true, lock: false })
  // Ruling E7: a task outside the caller's scope is opaque ({ outOfScope: true } only, counted in hiddenMoves): no id, ref, title or date leaks.
  // The hash still covers the full, unredacted moves.
  const visible = p.moves.filter((m) => !m.outOfScope).map((m) => ({ taskId: m.taskId, ref: m.ref, from: m.from, to: m.to, outOfScope: false as const, title: ctx.drive ? m.title : withholdDriveText(m.title) }))
  const hidden = p.moves.filter((m) => m.outOfScope).map(() => ({ outOfScope: true as const }))
  return { moves: [...visible, ...hidden], hiddenMoves: hidden.length, previewHash: p.previewHash }
}

/**
 * The reschedule shared by POST /reschedule and the approval of a date proposal. The caller holds the graph lock. A knock-on apply
 * locks the whole downstream set in id order, recomputes the moves from the locked rows and refuses (409 knock_on_changed) when the
 * result differs from the preview the manager saw; a move outside the manager's scope refuses everything (409 knock_on_out_of_scope).
 */
async function rescheduleLocked(
  tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string,
  input: { version: number; start?: string; due?: string; reason?: string; knockOn: KnockOnInput }, mode: "reschedule" | "approve",
): Promise<TaskDto> {
  const row0 = await getTask(tx, ctx, id) // 404 when out of scope or archived, before anything is locked
  const a0 = allAssignees((await assigneesOf(tx, ctx.tenantId, [row0.id])).get(row0.id)!)
  if (!canManage(ctx, row0, a0)) throw Forbidden("dates_manager_only")
  staleVersion(row0, input.version)
  let to: { start: string; due: string }
  if (mode === "approve") {
    const pr = row0.proposal as { start?: string; due?: string } | null
    if (!pr?.start || !pr.due) throw unprocessable("no_proposal")
    to = { start: pr.start, due: pr.due }
  } else to = { start: full(input.start!), due: full(input.due!) }
  checkRange(ctx, to.start, to.due)

  const p = await plan(tx, ctx, id, to, { withMoves: input.knockOn.apply, lock: true })
  const root = p.root
  staleVersion(root, input.version) // again, now that the row is locked
  if (!canManage(ctx, root, p.rootAssignees)) throw TaskNotFound() // its scope changed between the first read and the lock
  if (input.knockOn.apply) {
    if (input.knockOn.previewHash !== p.previewHash) throw Conflict("knock_on_changed")
    if (p.moves.some((m) => m.outOfScope)) throw Conflict("knock_on_out_of_scope")
  }

  const startAt = instantOfWall(to.start, ctx.tz)
  const dueAt = instantOfWall(to.due, ctx.tz)
  const rootChanges = diffFields({ start: root.startAt.toISOString(), due: root.dueAt.toISOString() }, { start: startAt.toISOString(), due: dueAt.toISOString() })
  const clearsProposal = root.proposal !== null
  const events: { taskId: string; historyId: string; fields: string[] }[] = []
  let result = root
  if (rootChanges.length > 0 || clearsProposal) {
    ;[result] = await tx
      .update(tasks)
      .set({ startAt, dueAt, proposal: null, version: root.version + 1, updatedAt: ctx.now })
      .where(and(eq(tasks.id, root.id), eq(tasks.tenantId, ctx.tenantId)))
      .returning()
    const recipients = changeRecipients(ctx, root, p.rootAssignees)
    const lead = mode === "approve" ? "Date proposal approved" : "Rescheduled"
    const historyId = await writeHistory(tx, ctx, root.id, { kind: mode === "approve" ? "proposal_approved" : "rescheduled", text: input.reason ? `${lead}: ${input.reason}` : lead, changes: rootChanges, notified: recipients })
    await notifyTask(tx, env, ctx, result, recipients, mode === "approve" ? "Date proposal approved" : "Task rescheduled")
    events.push({ taskId: root.id, historyId, fields: [...rootChanges.map((c) => c.field), ...(clearsProposal ? ["proposal"] : [])] })
  }
  for (const m of input.knockOn.apply ? p.moves : []) {
    const r = p.rows.get(m.taskId)!
    const s = instantOfWall(m.to.start, ctx.tz)
    const d = instantOfWall(m.to.due, ctx.tz)
    const changes = diffFields({ start: r.startAt.toISOString(), due: r.dueAt.toISOString() }, { start: s.toISOString(), due: d.toISOString() })
    const [moved] = await tx.update(tasks).set({ startAt: s, dueAt: d, proposal: null, version: r.version + 1, updatedAt: ctx.now }).where(and(eq(tasks.id, r.id), eq(tasks.tenantId, ctx.tenantId))).returning()
    const recipients = changeRecipients(ctx, r, p.people.get(r.id) ?? [])
    const historyId = await writeHistory(tx, ctx, r.id, { kind: "rescheduled", text: "Moved because another task was rescheduled", causeTaskId: root.id, changes, notified: recipients })
    await notifyTask(tx, env, ctx, moved, recipients, "Task rescheduled")
    events.push({ taskId: r.id, historyId, fields: changes.map((c) => c.field) })
  }
  const dto = await detail(tx, ctx, result)
  for (const e of events) await publishTaskEvent(tx, ctx, { type: "task.updated", payload: e })
  return dto
}

/** POST /v1/tasks/{id}/reschedule (managers). */
export const rescheduleTask = (tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: RescheduleInput): Promise<TaskDto> => rescheduleLocked(tx, env, ctx, id, input, "reschedule")

// ---------- date proposals (Q8) ----------

/** The managers whose scope covers the task, as recipients: all-scope managers, and team-scope ones who are on the task or manage an assignee. */
async function managersInScope(tx: TenantTx, ctx: TaskCtx, task: TaskRow, assignees: string[]): Promise<string[]> {
  const cands = await tx
    .select({ userId: memberships.userId, id: roles.id, key: roles.key, home: roles.home, access: roles.access })
    .from(memberships)
    .innerJoin(roles, and(eq(roles.id, memberships.roleId), eq(roles.tenantId, memberships.tenantId)))
    .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active"), eq(roles.home, "manager")))
  const lines = assignees.length ? await tx.select({ m: reportingLines.managerId }).from(reportingLines).where(and(eq(reportingLines.tenantId, ctx.tenantId), inArray(reportingLines.userId, assignees))) : []
  const bosses = new Set(lines.map((l) => l.m))
  const own = new Set([...assignees, ...(task.creatorId ? [task.creatorId] : []), ...(task.evidenceRule.reviewer ? [task.evidenceRule.reviewer] : [])])
  const out: string[] = []
  for (const c of cands) {
    const role = { id: c.id, key: c.key, home: "manager", access: c.access } as unknown as ResolvedRole
    if (!can(role, "tasks", "write")) continue
    const team = (await effectiveReportScope(tx, ctx.tenantId, role)) === "team"
    if (!team || own.has(c.userId) || bosses.has(c.userId)) out.push(c.userId)
  }
  return out
}

/** POST /v1/tasks/{id}/date-proposal: an assignee proposes new dates (a manager decides). Replaces an earlier proposal. */
export async function proposeDates(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { start: string; due: string; reason: string }): Promise<TaskDto> {
  const { row, assignees, mine } = await lockedTask(tx, ctx, id)
  if (!mine) throw Forbidden("forbidden")
  const start = full(input.start)
  const due = full(input.due)
  checkRange(ctx, start, due)
  const proposal = { start, due, reason: input.reason, by: ctx.me, at: wallOf(ctx.now, ctx.tz) }
  const [next] = await tx.update(tasks).set({ proposal, version: row.version + 1, updatedAt: ctx.now }).where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId))).returning()
  const recipients = (await managersInScope(tx, ctx, row, assignees)).filter((u) => u !== ctx.me && u !== ctx.actorId).sort()
  const historyId = await writeHistory(tx, ctx, row.id, { kind: "proposal", text: `Proposed new dates ${formatDateTime(start)} to ${formatDateTime(due)}: ${input.reason}`, notified: recipients })
  await notifyTask(tx, env, ctx, next, recipients, "Date change proposed")
  const dto = await detail(tx, ctx, next)
  await publishTaskEvent(tx, ctx, { type: "task.updated", payload: { taskId: row.id, historyId, fields: ["proposal"] } })
  return dto
}

/** POST /v1/tasks/{id}/date-proposal/approve: the reschedule path with the proposed dates (graph lock held by the caller). */
export const approveProposal = (tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { version: number; knockOn: KnockOnInput }): Promise<TaskDto> => rescheduleLocked(tx, env, ctx, id, input, "approve")

/** POST /v1/tasks/{id}/date-proposal/decline: clears the proposal; the assignees hear why. */
export async function declineProposal(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { version: number; reason?: string }): Promise<TaskDto> {
  const { row, assignees, manage } = await lockedTask(tx, ctx, id)
  if (!manage) throw Forbidden("forbidden")
  staleVersion(row, input.version)
  if (!row.proposal) throw unprocessable("no_proposal")
  const [next] = await tx.update(tasks).set({ proposal: null, version: row.version + 1, updatedAt: ctx.now }).where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId))).returning()
  const recipients = changeRecipients(ctx, row, assignees)
  const historyId = await writeHistory(tx, ctx, row.id, { kind: "proposal_declined", text: input.reason ? `Date proposal declined: ${input.reason}` : "Date proposal declined", notified: recipients })
  await notifyTask(tx, env, ctx, next, recipients, "Date proposal declined")
  const dto = await detail(tx, ctx, next)
  await publishTaskEvent(tx, ctx, { type: "task.updated", payload: { taskId: row.id, historyId, fields: ["proposal"] } })
  return dto
}
