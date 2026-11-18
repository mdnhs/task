import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm"
import { z } from "@hono/zod-openapi"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { can } from "@opsdesk/domain/permissions"
import { NO_EVIDENCE } from "@opsdesk/domain/task-evidence"
import { taskScope } from "@opsdesk/domain/task-scope"
import type { ResolvedRole } from "../../core/context"
import { AppError, NotFound } from "../../core/errors"
import { memberships, roles, taskChecklistItems, taskComments, taskFiles, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { directReports, effectiveReportScope } from "../teams"
import { decodeCursor, encodeCursor } from "../../core/cursor"
import { type TaskDto } from "./dto"
import { publishTaskEvent } from "./events"
import { namesOf, writeHistory } from "./history"
import { changeRecipients, notifyTask, type TaskEnv } from "./notify"
import { allAssignees, assigneesOf, replaceAssignees } from "./repo"
import { canManage, getTask, inScope, type TaskCtx, type TaskRow } from "./scope"
import { taskDetailDto } from "./service"
import { wallOf } from "./time"

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const forbidden = () => new AppError(403, "forbidden", "Forbidden")

export const CHECKLIST_MAX = 50
export const COMMENT_MENTIONS_MAX = 20
export const COMMENT_FILES_MAX = 5

// ---------- request bodies and responses (R5: every JSON body declares an example) ----------

const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const UID = "usr_8Kq2mZ4tW1"
const Uuid = (name: string) => z.uuid().openapi({ param: { name, in: "path" }, example: TID })

export const ItemParams = z.object({ id: Uuid("id"), itemId: Uuid("itemId") })
export const CommentParams = z.object({ id: Uuid("id"), commentId: Uuid("commentId") })

export const ChecklistBody = z.object({ text: z.string().trim().min(1).max(200) }).openapi({ example: { text: "Check the extinguishers" } })
export const ChecklistPatchBody = z
  .object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(200).optional() })
  .refine((b) => b.done !== undefined || b.text !== undefined)
  .openapi({ example: { done: true } })
export const ChecklistItemSchema = z
  .object({ id: z.uuid(), text: z.string(), done: z.boolean(), position: z.number().int(), doneBy: z.string().nullable(), doneAt: z.string().nullable() })
  .openapi({ example: { id: TID, text: "Check the extinguishers", done: false, position: 1, doneBy: null, doneAt: null } })
export const SubtaskBody = z.object({ title: z.string().trim().min(1).max(200) }).openapi({ example: { title: "Walk the first floor" } })

export const CommentBody = z
  .object({
    body: z.string().trim().min(1).max(4000),
    mentions: z.array(z.string().min(1).max(128)).max(COMMENT_MENTIONS_MAX).default([]),
    attachmentFileIds: z.array(z.uuid()).max(COMMENT_FILES_MAX).default([]),
  })
  .openapi({ example: { body: "Done for the ground floor.", mentions: [UID], attachmentFileIds: [] } })
export const CommentSchema = z
  .object({
    id: z.uuid(), taskId: z.uuid(), authorId: z.string().nullable(), author: z.string(), body: z.string(), mentions: z.array(z.string()),
    attachmentFileIds: z.array(z.string()), at: z.string(), atUtc: z.string(),
  })
  .openapi({ example: { id: TID, taskId: TID, authorId: UID, author: "Ann Byrne", body: "Done for the ground floor.", mentions: [UID], attachmentFileIds: [], at: "2026-11-20T10:00:00", atUtc: "2026-11-20T10:00:00.000Z" } })
export const CommentList = z.object({ items: z.array(CommentSchema), nextCursor: z.string().nullable() }).openapi({ example: { items: [], nextCursor: null } })
export const CommentQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(300).optional() })
export type CommentDto = z.infer<typeof CommentSchema>
export type ChecklistItemDto = z.infer<typeof ChecklistItemSchema>

// ---------- shared ----------

/** The task under its row lock (lock order: ... → task row → writes) with who the caller is for it. */
async function lockedTask(tx: TenantTx, ctx: TaskCtx, id: string) {
  const row = await getTask(tx, ctx, id, { forUpdate: true })
  const assignees = allAssignees((await assigneesOf(tx, ctx.tenantId, [row.id])).get(row.id)!)
  return { row, assignees, manage: canManage(ctx, row, assignees), mine: assignees.includes(ctx.me), creator: row.creatorId === ctx.me }
}

const itemDto = (r: typeof taskChecklistItems.$inferSelect, ctx: Pick<TaskCtx, "tz" | "drive">): ChecklistItemDto => ({
  id: r.id, text: ctx.drive ? r.text : withholdDriveText(r.text), done: r.done, position: r.position, doneBy: r.doneBy, doneAt: r.doneAt ? wallOf(r.doneAt, ctx.tz) : null,
})
const ItemNotFound = () => NotFound("checklist_item_not_found")
const CommentNotFound = () => NotFound("comment_not_found")

// ---------- checklist (FR-M1-02; children never bump task.version, ruling D4) ----------

/** POST /v1/tasks/{id}/checklist: an assignee, a manager or the creator; 422 checklist_limit at 50 (counted under the task row lock). */
export async function addChecklistItem(tx: TenantTx, ctx: TaskCtx, id: string, input: { text: string }): Promise<ChecklistItemDto> {
  const { row, manage, mine, creator } = await lockedTask(tx, ctx, id)
  if (!manage && !mine && !creator) throw forbidden()
  const [stat] = await tx
    .select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${taskChecklistItems.position}), 0)::int` })
    .from(taskChecklistItems)
    .where(and(eq(taskChecklistItems.tenantId, ctx.tenantId), eq(taskChecklistItems.taskId, row.id)))
  if (stat.n >= CHECKLIST_MAX) throw unprocessable("checklist_limit")
  const [item] = await tx.insert(taskChecklistItems).values({ tenantId: ctx.tenantId, taskId: row.id, text: input.text, position: stat.max + 1 }).returning()
  await writeHistory(tx, ctx, row.id, { kind: "checklist", text: `Checklist item added: ${input.text}` })
  return itemDto(item, ctx)
}

async function itemOf(tx: TenantTx, ctx: TaskCtx, taskId: string, itemId: string) {
  const [item] = await tx.select().from(taskChecklistItems).where(and(eq(taskChecklistItems.tenantId, ctx.tenantId), eq(taskChecklistItems.taskId, taskId), eq(taskChecklistItems.id, itemId))).for("update")
  if (!item) throw ItemNotFound() // another task's item and a missing one look the same
  return item
}

/** PATCH /v1/tasks/{id}/checklist/{itemId}: `done` is absolute (assignee, manager or creator); `text` is for the creator or a manager. */
export async function patchChecklistItem(tx: TenantTx, ctx: TaskCtx, id: string, itemId: string, input: { done?: boolean; text?: string }): Promise<ChecklistItemDto> {
  const { row, manage, mine, creator } = await lockedTask(tx, ctx, id)
  const item = await itemOf(tx, ctx, row.id, itemId)
  if (input.text !== undefined && !manage && !creator) throw forbidden()
  if (input.done !== undefined && !manage && !mine && !creator) throw forbidden()
  const set: Partial<typeof taskChecklistItems.$inferInsert> = {}
  if (input.text !== undefined && input.text !== item.text) set.text = input.text
  if (input.done !== undefined && input.done !== item.done) Object.assign(set, input.done ? { done: true, doneBy: ctx.actorId, doneAt: ctx.now } : { done: false, doneBy: null, doneAt: null })
  if (Object.keys(set).length === 0) return itemDto(item, ctx)
  const [next] = await tx.update(taskChecklistItems).set(set).where(and(eq(taskChecklistItems.id, item.id), eq(taskChecklistItems.tenantId, ctx.tenantId))).returning()
  if (set.done !== undefined) {
    await writeHistory(tx, ctx, row.id, { kind: "checklist", text: `Checklist: ${next.text}`, changes: [{ field: "Checklist", from: item.done ? "Done" : "Open", to: next.done ? "Done" : "Open" }] })
  }
  if (set.text !== undefined) await writeHistory(tx, ctx, row.id, { kind: "checklist", text: `Checklist item edited: ${next.text}` })
  return itemDto(next, ctx)
}

/** DELETE /v1/tasks/{id}/checklist/{itemId}: the creator or a manager. */
export async function deleteChecklistItem(tx: TenantTx, ctx: TaskCtx, id: string, itemId: string): Promise<void> {
  const { row, manage, creator } = await lockedTask(tx, ctx, id)
  const item = await itemOf(tx, ctx, row.id, itemId)
  if (!manage && !creator) throw forbidden()
  await tx.delete(taskChecklistItems).where(and(eq(taskChecklistItems.id, item.id), eq(taskChecklistItems.tenantId, ctx.tenantId)))
  await writeHistory(tx, ctx, row.id, { kind: "checklist", text: `Checklist item removed: ${item.text}` })
}

// ---------- subtasks (ruling D24) ----------
// History lines name no ref or title of the other task: a viewer of the parent may not see the child (and the reverse), so the lines say
// only that a subtask was added; the visible subtasks (scope-checked) and parentRef come from the DTO.

/**
 * POST /v1/tasks/{id}/subtasks: one level deep (422 subtask_depth). Copies team, project, milestone, priority and due date; the primary
 * assignee is the parent's when the caller may assign that person (ruling D6/E2: staff create for themselves, a team manager for
 * themself or a direct report), else the caller. No evidence by default (makeSubtask). The caller already took the ref (nextRefNo).
 */
export async function createSubtask(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, parentId: string, refNo: number, input: { title: string }): Promise<TaskDto> {
  const { row: parent, manage, mine, creator } = await lockedTask(tx, ctx, parentId)
  if (!manage && !mine && !creator) throw forbidden()
  if (parent.parentId) throw unprocessable("subtask_depth")
  const parentPrimary = (await assigneesOf(tx, ctx.tenantId, [parent.id])).get(parent.id)!.primary
  const may = (u: string) => ctx.scope.kind === "all" || u === ctx.me || (ctx.scope.kind === "team" && ctx.reports.includes(u))
  const primary = parentPrimary && may(parentPrimary) ? parentPrimary : ctx.me
  const startAt = ctx.now.getTime() < parent.dueAt.getTime() ? ctx.now : parent.dueAt
  const [row] = await tx
    .insert(tasks)
    .values({
      tenantId: ctx.tenantId, refNo, title: input.title, description: "", teamId: parent.teamId, creatorId: ctx.me, priority: parent.priority, startAt, dueAt: parent.dueAt,
      projectId: parent.projectId, milestoneId: parent.milestoneId, parentId: parent.id, evidenceRule: { ...NO_EVIDENCE }, createdAt: ctx.now, updatedAt: ctx.now,
    })
    .returning()
  await replaceAssignees(tx, ctx.tenantId, row.id, primary, [])
  const recipients = changeRecipients(ctx, row, [primary])
  await writeHistory(tx, ctx, row.id, { kind: "created", text: "Created as a subtask", notified: recipients })
  await writeHistory(tx, ctx, parent.id, { kind: "subtask", text: "Subtask added" })
  await notifyTask(tx, env, ctx, row, recipients, "New task")
  const dto = await taskDetailDto(tx, ctx, row)
  await publishTaskEvent(tx, ctx, { type: "task.created", payload: { taskId: row.id, parentId: parent.id, projectId: row.projectId, seriesId: null } })
  return dto
}

// ---------- comments (ruling D16) ----------

/**
 * Which of `ids` are active members who could open this task themselves (their role's tasks:read and their own scope, ruling D5), so
 * a mention never reaches someone who cannot see it. Used only to pick notification recipients: the response never depends on it.
 */
async function canSee(tx: TenantTx, ctx: TaskCtx, task: Pick<TaskRow, "creatorId" | "evidenceRule">, assignees: string[], ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await tx
    .select({ userId: memberships.userId, role: roles })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active"), inArray(memberships.userId, ids)))
  const out: string[] = []
  for (const r of rows) {
    const role: ResolvedRole = {
      id: r.role.id, key: r.role.key, label: r.role.label, description: r.role.description, home: r.role.home === "staff" ? "staff" : "manager",
      access: r.role.access as ResolvedRole["access"], fieldRules: r.role.fieldRules,
    }
    if (!can(role, "tasks", "read")) continue
    const scope = taskScope({ ...role, reportScope: await effectiveReportScope(tx, ctx.tenantId, role) }, r.userId)
    if (!scope) continue
    const reports = scope.kind === "team" ? await directReports(tx, r.userId) : []
    if (inScope({ scope, reports }, task, assignees)) out.push(r.userId)
  }
  return out
}

async function commentDtos(tx: TenantTx, ctx: Pick<TaskCtx, "tz" | "drive">, rows: (typeof taskComments.$inferSelect)[]): Promise<CommentDto[]> {
  const nameOf = await namesOf(tx, rows.flatMap((r) => (r.authorId ? [r.authorId] : [])))
  return rows.map((r) => ({
    id: r.id, taskId: r.taskId, authorId: r.authorId, author: r.authorId ? nameOf(r.authorId) : "Former member",
    body: ctx.drive ? r.body : withholdDriveText(r.body), // ruling D22
    mentions: r.mentions, attachmentFileIds: r.attachmentFileIds, at: wallOf(r.createdAt, ctx.tz), atUtc: r.createdAt.toISOString(),
  }))
}

/**
 * POST /v1/tasks/{id}/comments. Anyone who can see the task may comment. Attachments must be `task_attachment` files of THIS task
 * (422 invalid_attachment, the same for another task's file and a random id). Mentions are stored as sent and echoed back; only mentioned
 * members who can see the task are notified (no oracle: the answer and the history line do not depend on who could). The task's assignees
 * and creator are told too, except the author.
 */
export async function addComment(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { body: string; mentions: string[]; attachmentFileIds: string[] }): Promise<CommentDto> {
  const { row, assignees } = await lockedTask(tx, ctx, id)
  const mentions = [...new Set(input.mentions)]
  const fileIds = [...new Set(input.attachmentFileIds)]
  if (fileIds.length) {
    const found = await tx
      .select({ id: taskFiles.fileId })
      .from(taskFiles)
      .where(and(eq(taskFiles.tenantId, ctx.tenantId), eq(taskFiles.taskId, row.id), eq(taskFiles.purpose, "task_attachment"), inArray(taskFiles.fileId, fileIds)))
    if (found.length !== fileIds.length) throw unprocessable("invalid_attachment")
  }
  const [c] = await tx
    .insert(taskComments)
    .values({ tenantId: ctx.tenantId, taskId: row.id, authorId: ctx.actorId, body: input.body, mentions, attachmentFileIds: fileIds, createdAt: ctx.now })
    .returning()
  const notMe = (u: string) => u !== ctx.me && u !== ctx.actorId
  const mentioned = (await canSee(tx, ctx, row, assignees, mentions)).filter(notMe).sort()
  const others = changeRecipients(ctx, row, assignees).filter((u) => !mentioned.includes(u))
  // `notified` lists the assignees and creator only: mention recipients stay out of it (it would show who could see the task)
  await writeHistory(tx, ctx, row.id, { kind: "comment", text: "Comment added", notified: others })
  await notifyTask(tx, env, ctx, row, mentioned, "You were mentioned")
  await notifyTask(tx, env, ctx, row, others, "New comment")
  const [dto] = await commentDtos(tx, ctx, [c])
  await publishTaskEvent(tx, ctx, { type: "task.comment_added", payload: { taskId: row.id, commentId: c.id } })
  return dto
}

/** The comments list statement (exported so the EXPLAIN test plans the exact query). */
export function buildCommentsQuery(tx: TenantTx, tenantId: string, taskId: string, after: { at: Date; id: string } | null, take: number) {
  return tx
    .select()
    .from(taskComments)
    .where(
      and(
        eq(taskComments.tenantId, tenantId), eq(taskComments.taskId, taskId), isNull(taskComments.deletedAt),
        after ? or(gt(taskComments.createdAt, after.at), and(eq(taskComments.createdAt, after.at), gt(taskComments.id, after.id))) : undefined,
      ),
    )
    .orderBy(asc(taskComments.createdAt), asc(taskComments.id))
    .limit(take)
}

/** GET /v1/tasks/{id}/comments: oldest first, keyset on (created_at, id) via task_comments_task_idx. */
export async function listComments(tx: TenantTx, ctx: TaskCtx, id: string, o: { limit: number; cursor?: string }): Promise<{ items: CommentDto[]; nextCursor: string | null }> {
  const row = await getTask(tx, ctx, id)
  const rows = await buildCommentsQuery(tx, ctx.tenantId, row.id, o.cursor ? decodeCursor(o.cursor) : null, o.limit + 1)
  const page = rows.slice(0, o.limit)
  const last = page[page.length - 1]
  return { items: await commentDtos(tx, ctx, page), nextCursor: rows.length > o.limit && last ? encodeCursor(last.createdAt, last.id) : null }
}

/** DELETE /v1/tasks/{id}/comments/{commentId}: its author, or a manager of the task. Soft delete. */
export async function deleteComment(tx: TenantTx, ctx: TaskCtx, id: string, commentId: string): Promise<void> {
  const { row, manage } = await lockedTask(tx, ctx, id)
  const [c] = await tx
    .select()
    .from(taskComments)
    .where(and(eq(taskComments.tenantId, ctx.tenantId), eq(taskComments.taskId, row.id), eq(taskComments.id, commentId), isNull(taskComments.deletedAt)))
    .for("update")
  if (!c) throw CommentNotFound()
  const author = c.authorId !== null && (c.authorId === ctx.actorId || c.authorId === ctx.me)
  if (!author && !manage) throw forbidden()
  await tx.update(taskComments).set({ deletedAt: ctx.now }).where(and(eq(taskComments.id, c.id), eq(taskComments.tenantId, ctx.tenantId)))
  await writeHistory(tx, ctx, row.id, { kind: "comment", text: "Comment deleted" })
}
