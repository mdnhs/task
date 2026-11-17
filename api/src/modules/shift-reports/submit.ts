import { and, asc, desc, eq, inArray } from "drizzle-orm"
import type { z } from "@hono/zod-openapi"
import { can } from "@opsdesk/domain/permissions"
import { validateReport, type ShiftReport } from "@opsdesk/domain/shift-report"
import { isOpen } from "@opsdesk/domain/task-lifecycle"
import type { TaskStatus } from "@opsdesk/domain/task-model"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { AppError, Conflict } from "../../core/errors"
import { memberships, reportingLines, roles, shiftReportItems, shiftReportVersions, shiftReports, taskAssignees, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import { notify, type Enqueue } from "../notifications"
import { applyTaskUpdate, publishTaskEvent, TaskNotFound, wallOf, type TaskEvent } from "../tasks"
import { liveAttachmentIds } from "./draft"
import type { ReportItemDto, SubmitBody } from "./dto"
import { publishReportEvent } from "./events"
import { assertOwner, editable, getReport, type ReportCtx, type ReportRow } from "./scope"
import { reportTemplateFor } from "./template"
import type { Deps } from "../../deps"

type Outcome = NonNullable<ReportItemDto["outcome"]>
type SnapshotItem = { ref: string; taskId: string | null; title: string; status: string; minutes: number; note: string; outcome: Outcome }

/**
 * POST /{id}/submit (ruling F7). ONE tx, in this lock order (the brief's, E8-E10): the actor lock (taken by loadReportCtx) -> the report row FOR UPDATE -> its task rows
 * `FOR UPDATE ORDER BY id` -> writes (task updates, version, report) -> history -> notify -> audit -> publish LAST. Two submits touching the same tasks therefore lock in the
 * same global id order and cannot deadlock with each other; a manager PATCH of one task locks only that row (and fails with 409 version_conflict when it read before our commit).
 *
 * What a submit may change on a task, and nothing else (D4): the task's STATUS (never backwards: a submitted, completed or cancelled task keeps its status; Done goes through
 * the T4.6 completion path `settleCompletion(strict: false)`, so a pending scan is "evidence still needed", never a failure, and a Required task without clean evidence stays open),
 * one time entry per row with the extra minutes (F8), one history line per row, and the task's own `version` + 1 when the status moved. Dates, assignees, evidence items
 * are never touched here (an infected pending item is auto-rejected by applyCompletion, exactly as on Complete). Each row's task is re-read under its lock, so a status the
 * manager set a moment earlier is the base, not a stale copy.
 *
 * Idempotency (F7): the same `requestId` finds its version row under the report lock and returns the report as it is, writing nothing. A stale `version` is 409 version_conflict
 * (checked before the status, so the loser of a double submit with different ids gets version_conflict, not report_locked); submitted or accepted is 409 report_locked.
 */
export async function submitReport(tx: TenantTx, env: { deps: Deps; enqueue: Enqueue }, ctx: ReportCtx, id: string, input: z.infer<typeof SubmitBody>): Promise<ReportRow> {
  const row = await getReport(tx, ctx, id, { forUpdate: true })
  assertOwner(ctx, row)
  const [replay] = await tx.select({ id: shiftReportVersions.id }).from(shiftReportVersions).where(and(eq(shiftReportVersions.reportId, id), eq(shiftReportVersions.requestId, input.requestId)))
  if (replay) return row
  if (input.version !== row.version) throw Conflict("version_conflict")
  if (!editable(row.status)) throw Conflict("report_locked")

  const items = await tx.select().from(shiftReportItems).where(and(eq(shiftReportItems.tenantId, ctx.tenantId), eq(shiftReportItems.reportId, id))).orderBy(asc(shiftReportItems.position))
  const unplanned = row.unplanned.filter((u) => u.text.trim())
  const attachmentIds = await liveAttachmentIds(tx, ctx.tenantId, id)
  // template validation first (cheap, and a failure holds no task lock): the same required-field rules as the domain validateReport
  const template = await reportTemplateFor(tx, ctx.tenantId, row.teamId)
  const errors = validateReport(
    {
      items: items.map((i) => ({ taskRef: `TSK-${i.taskRef}`, title: i.title, due: "", status: i.status, minutes: i.minutes, note: i.note })),
      summary: row.summary, blockers: row.blockers, unplanned, extra: row.extra, attachments: attachmentIds.map((a) => ({ id: a, name: "", kind: "file", size: "" })),
    } as unknown as ShiftReport,
    template,
  )
  if (errors.length) throw new AppError(422, "report_invalid", "Unprocessable Entity", { errors })

  // lock the tasks of the rows in id order (after the report row), then read them FRESH under the lock
  const taskIds = [...new Set(items.flatMap((i) => (i.taskId ? [i.taskId] : [])))]
  const before = new Map<string, string>()
  let assigned = new Set<string>()
  if (taskIds.length) {
    const locked = await tx.select({ id: tasks.id, status: tasks.status }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, taskIds))).orderBy(asc(tasks.id)).for("update", { of: [tasks] })
    for (const t of locked) before.set(t.id, t.status)
    // a report only updates tasks its author is STILL an assignee of: a task reassigned since the row was saved is skipped, even for a manager who could change it through the task itself
    assigned = new Set((await tx.select({ id: taskAssignees.taskId }).from(taskAssignees).where(and(eq(taskAssignees.tenantId, ctx.tenantId), eq(taskAssignees.userId, ctx.me), inArray(taskAssignees.taskId, taskIds)))).map((a) => a.id))
  }
  const [last] = await tx.select({ snapshot: shiftReportVersions.snapshot }).from(shiftReportVersions).where(eq(shiftReportVersions.reportId, id)).orderBy(desc(shiftReportVersions.v)).limit(1)
  const prevMinutes = new Map(((last?.snapshot as { items?: { ref: string; minutes: number }[] } | undefined)?.items ?? []).map((i) => [i.ref, i.minutes]))
  const v = row.submissions + 1
  const at = wallOf(ctx.now, ctx.tz).slice(0, 16)
  const canUpdate = ctx.task !== null && can(ctx.role, "tasks", "write")
  const events: TaskEvent[] = []
  const results = new Map<number, "applied" | "duplicate" | "skipped_archived" | "skipped_unavailable">()
  for (const i of items) {
    const ref = `TSK-${i.taskRef}`
    if (!i.taskId || !before.has(i.taskId) || !assigned.has(i.taskId) || !canUpdate) {
      results.set(i.position, "skipped_unavailable") // a purged task (task_id was nulled), or a caller without task access: the row stays in the report
      continue
    }
    try {
      results.set(
        i.position,
        await applyTaskUpdate(tx, ctx.task!, { id: `${id}.v${v}.${ref}`, tenantId: ctx.tenantId, ref, itemStatus: i.status as "done", minutes: Math.max(0, i.minutes - (prevMinutes.get(ref) ?? 0)), note: "", at, by: ctx.me, source: `shift report ${row.shiftName}, ${row.shiftDate}` }, { events }),
      )
    } catch (e) {
      if (!(e instanceof AppError) || e.code !== TaskNotFound().code) throw e // no longer an assignee / out of scope: skipped, nothing was written for this row
      results.set(i.position, "skipped_unavailable")
    }
  }
  const after = new Map<string, string>()
  if (taskIds.length) for (const t of await tx.select({ id: tasks.id, status: tasks.status }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, taskIds)))) after.set(t.id, t.status)
  const snapshotItems = items.map((i): SnapshotItem => {
    const res = results.get(i.position)!
    const was = i.taskId ? before.get(i.taskId) : undefined
    const now = i.taskId ? after.get(i.taskId) : undefined
    const outcome: Outcome = res === "skipped_archived" ? "skipped_archived" : res === "skipped_unavailable" ? "skipped_unavailable"
      : i.status === "done" && was && isOpen({ status: was as TaskStatus }) ? (now === "completed" ? "applied" : now === "submitted" ? "submitted_for_review" : "needs_evidence") : "applied"
    return { ref: `TSK-${i.taskRef}`, taskId: i.taskId, title: i.title, status: i.status, minutes: i.minutes, note: i.note, outcome }
  })
  await tx.insert(shiftReportVersions).values({
    tenantId: ctx.tenantId, reportId: id, v, at: ctx.now, byUser: ctx.me, requestId: input.requestId, note: row.submissions > 0 ? "Resubmitted" : "Submitted",
    snapshot: { summary: row.summary, blockers: row.blockers, unplanned, extra: row.extra, attachmentFileIds: attachmentIds, items: snapshotItems },
  })
  const [out] = await tx
    .update(shiftReports)
    .set({ status: "submitted", unplanned, firstSubmittedAt: row.firstSubmittedAt ?? ctx.now, submittedAt: ctx.now, version: row.version + 1, submissions: v, updatedAt: ctx.now })
    .where(and(eq(shiftReports.id, id), eq(shiftReports.tenantId, ctx.tenantId)))
    .returning()
  // history lines were written by applyTaskUpdate; now notify (shift name and date only, no report text: E13), audit, then publish LAST (task events, then ours)
  for (const userId of await recipients(tx, ctx.tenantId, ctx.me)) {
    await notify(tx, ctx.tenantId, { userId, kind: "report", title: "Shift report submitted", body: `${withholdDriveText(row.shiftName)}, ${row.shiftDate}`, link: `/reports/${id}`, subjectUserId: ctx.me }, env.deps, env.enqueue)
  }
  await recordAudit(tx, ctx.tenantId, { action: "shift.report.submitted", entity: "shift_report", entityId: id, actorId: ctx.actorId, before: { status: row.status, version: row.version }, after: { status: "submitted", version: out.version, v } }, ctx.now)
  if (ctx.task) for (const e of events) await publishTaskEvent(tx, ctx.task, e)
  await publishReportEvent(tx, ctx, { type: "shift.report.submitted", payload: { reportId: id, version: v } })
  return out
}

/** Who is told: the member's primary manager (reporting line), else the active owners (a member with no manager must not be silent, F12); never the submitter. */
async function recipients(tx: TenantTx, tenantId: string, me: string): Promise<string[]> {
  const [line] = await tx.select({ m: reportingLines.managerId }).from(reportingLines).where(and(eq(reportingLines.tenantId, tenantId), eq(reportingLines.userId, me)))
  const ids = line
    ? [line.m]
    : (await tx.select({ u: memberships.userId }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), eq(roles.key, "owner"))).orderBy(asc(memberships.userId))).map((r) => r.u)
  return ids.filter((u) => u !== me)
}
