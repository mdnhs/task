import { and, asc, eq, gte, lte, ne } from "drizzle-orm"
import { addDays, dueInstant, epochToWall } from "@opsdesk/domain/shifts"
import { itemStatusOf } from "@opsdesk/domain/shift-report"
import { Conflict, NotFound } from "../../core/errors"
import { files, shiftReportFiles, shiftReportItems, shiftReports } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { expireFile } from "../files"
import { effectiveReporting, loadReportingMaps, occurrencesBetween, reportDueAfterMinutes, reportingFrom } from "../shifts"
import { listTasksForPerson, unprocessable } from "../tasks"
import type { Enqueue } from "../notifications"
import type { z } from "@hono/zod-openapi"
import type { DraftBody } from "./dto"
import { assertOwner, editable, getReport, type ReportCtx, type ReportRow } from "./scope"
import { stateOf } from "./view"

const refNoOf = (ref: string): number => Number(ref.slice("TSK-".length))
const byTaskId = (a: { taskId: string | null }, b: { taskId: string | null }): number => (a.taskId ?? "") < (b.taskId ?? "") ? -1 : (a.taskId ?? "") > (b.taskId ?? "") ? 1 : 0

/**
 * POST /open (ruling F4): get-or-create the CALLER'S OWN report row for one of their shifts. The shift must be one the caller is assigned to on that date (a live pattern,
 * the pattern's own weekday) and must have started; otherwise 404 shift_not_found, whoever else's shift it is. Reporting off for the shift's team (and no row yet) is 422.
 * Idempotent on the unique key: two concurrent opens insert once (ON CONFLICT DO NOTHING), the loser reads the winner's row. The instants are computed from the pattern ONCE
 * and stored (F3). The rows of the draft are the shift's tasks (listTasksForPerson).
 */
export async function openReport(tx: TenantTx, ctx: ReportCtx, input: { patternId: string; date: string }): Promise<{ row: ReportRow; created: boolean }> {
  const key = and(eq(shiftReports.tenantId, ctx.tenantId), eq(shiftReports.userId, ctx.me), eq(shiftReports.patternId, input.patternId), eq(shiftReports.shiftDate, input.date))
  const [existing] = await tx.select().from(shiftReports).where(key)
  if (existing) return { row: existing, created: false }
  const occ = (await occurrencesBetween(tx, ctx.tenantId, ctx.tz, input.date, input.date, { userIds: [ctx.me] })).find((o) => o.patternId === input.patternId)
  if (!occ || occ.startAt.getTime() > ctx.now.getTime()) throw NotFound("shift_not_found")
  if (!(await effectiveReporting(tx, ctx.tenantId, ctx.me, occ.teamId))) throw unprocessable("reporting_off")
  const dueAt = new Date(dueInstant(occ.endAt.getTime(), await reportDueAfterMinutes(tx, ctx.tenantId)))
  const [row] = await tx
    .insert(shiftReports)
    .values({ tenantId: ctx.tenantId, userId: ctx.me, patternId: occ.patternId, shiftDate: occ.shiftDate, teamId: occ.teamId, shiftName: occ.name, startAt: occ.startAt, endAt: occ.endAt, dueAt, createdAt: ctx.now, updatedAt: ctx.now })
    .onConflictDoNothing()
    .returning()
  if (!row) {
    const [winner] = await tx.select().from(shiftReports).where(key) // the concurrent open committed first
    return { row: winner, created: false }
  }
  const rows = ctx.task ? await listTasksForPerson(tx, ctx.task, ctx.me, { fromUtc: occ.startAt, toUtc: occ.endAt }) : []
  if (rows.length) {
    // `position` keeps the due order the member sees; the INSERT order is the task id order, because each row takes the tasks FK's KEY SHARE lock and submit locks the
    // same tasks FOR UPDATE in id order (C2, T5.2 review): one global lock order, so an open or a draft save can never deadlock with a submit
    await tx.insert(shiftReportItems).values(
      rows.map((t, position) => ({ tenantId: ctx.tenantId, reportId: row.id, position, taskId: t.taskId, taskRef: refNoOf(t.ref), title: t.title, dueAt: t.dueAt, status: itemStatusOf(t.status), minutes: 0, note: "" })).sort(byTaskId),
    )
  }
  return { row, created: true }
}

/**
 * PUT /{id}/draft (ruling F7: optimistic `version`). Owner only, status draft or returned. The rows are merged by task: every task of the shift that has no row yet gets a default
 * one (the report lists exactly the shift's tasks, AC-M1-02), the given rows update status, time and note; a row of a task that LEFT the shift is kept and may still be edited
 * (it was reported on). A row for any other task is 422 item_not_in_shift. `attachmentFileIds`, when given, is the final set: a file of the report not in it is removed
 * (soft-deleted, its object queued), an id that is not one of THIS report's files is 404 report_file_not_found. Bumps `version`.
 */
export async function saveDraft(tx: TenantTx, enqueue: Enqueue, ctx: ReportCtx, id: string, body: z.infer<typeof DraftBody>): Promise<ReportRow> {
  const row = await getReport(tx, ctx, id, { forUpdate: true })
  assertOwner(ctx, row)
  if (body.version !== row.version) throw Conflict("version_conflict")
  if (!editable(row.status)) throw Conflict("report_locked")
  const have = await tx.select().from(shiftReportItems).where(and(eq(shiftReportItems.tenantId, ctx.tenantId), eq(shiftReportItems.reportId, id))).orderBy(asc(shiftReportItems.position))
  const shift = ctx.task ? await listTasksForPerson(tx, ctx.task, ctx.me, { fromUtc: row.startAt, toUtc: row.endAt }) : []
  const known = new Set([...have.flatMap((i) => (i.taskId ? [i.taskId] : [])), ...shift.map((t) => t.taskId)])
  for (const i of body.items) if (!known.has(i.taskId)) throw unprocessable("item_not_in_shift")
  const hasTask = new Set(have.flatMap((i) => (i.taskId ? [i.taskId] : [])))
  const fresh = shift.filter((t) => !hasTask.has(t.taskId))
  let position = have.reduce((m, i) => Math.max(m, i.position), -1) + 1
  if (fresh.length) {
    await tx.insert(shiftReportItems).values( // positions in due order, inserted in task id order (C2, see openReport)
      fresh.map((t) => ({ tenantId: ctx.tenantId, reportId: id, position: position++, taskId: t.taskId, taskRef: refNoOf(t.ref), title: t.title, dueAt: t.dueAt, status: itemStatusOf(t.status), minutes: 0, note: "" })).sort(byTaskId),
    )
  }
  for (const i of body.items) {
    await tx.update(shiftReportItems).set({ status: i.status, minutes: i.minutes, note: i.note }).where(and(eq(shiftReportItems.tenantId, ctx.tenantId), eq(shiftReportItems.reportId, id), eq(shiftReportItems.taskId, i.taskId)))
  }
  if (body.attachmentFileIds) {
    const mine = (await attachmentRows(tx, ctx.tenantId, id)).map((f) => f.id)
    const want = new Set(body.attachmentFileIds)
    for (const f of want) if (!mine.includes(f)) throw NotFound("report_file_not_found")
    for (const f of mine.filter((m) => !want.has(m)).sort()) {
      await expireFile(tx, ctx.tenantId, f, enqueue) // soft-deletes the file and queues its object (an infected file keeps its status, its object is removed)
      await tx.delete(shiftReportFiles).where(and(eq(shiftReportFiles.tenantId, ctx.tenantId), eq(shiftReportFiles.reportId, id), eq(shiftReportFiles.fileId, f)))
    }
  }
  const [out] = await tx
    .update(shiftReports)
    .set({ summary: body.summary, blockers: body.blockers, unplanned: body.unplanned, extra: body.extra, version: row.version + 1, updatedAt: ctx.now })
    .where(and(eq(shiftReports.id, id), eq(shiftReports.tenantId, ctx.tenantId)))
    .returning()
  return out
}

/** The attachments of a report that still exist (soft-deleted files are gone), with their scan state. */
export async function attachmentRows(tx: TenantTx, tenantId: string, reportId: string): Promise<{ id: string; status: string }[]> {
  return tx
    .select({ id: files.id, status: files.status })
    .from(shiftReportFiles)
    .innerJoin(files, and(eq(files.tenantId, shiftReportFiles.tenantId), eq(files.id, shiftReportFiles.fileId)))
    .where(and(eq(shiftReportFiles.tenantId, tenantId), eq(shiftReportFiles.reportId, reportId), ne(files.status, "deleted")))
}

/** The attachments that count (against the limit of five and for the template's "attach a file" rule): not deleted and not infected (an infected file is unusable and frees its slot). */
export async function liveAttachmentIds(tx: TenantTx, tenantId: string, reportId: string): Promise<string[]> {
  return (await attachmentRows(tx, tenantId, reportId)).filter((f) => f.status !== "infected").map((f) => f.id)
}

export type CurrentItem = { key: string; shiftName: string; shiftDate: string; startAt: string; endAt: string; dueAt: string; state: string; reportId: string | null }

/**
 * GET /current: the caller's OWN running shift, else the last ended one that is still a draft or was returned (never submitted: nothing to do on a submitted one), else null.
 * Computed from assignments and patterns (a virtual draft costs no row, F4); a stored row supplies its frozen instants (F3). Reporting must be on for the shift's team.
 */
export async function currentItem(tx: TenantTx, ctx: ReportCtx): Promise<CurrentItem | null> {
  const today = epochToWall(ctx.now.getTime(), ctx.tz).slice(0, 10)
  const from = addDays(today, -15)
  const to = addDays(today, 1)
  const maps = await loadReportingMaps(tx, ctx.tenantId)
  const occs = (await occurrencesBetween(tx, ctx.tenantId, ctx.tz, from, to, { userIds: [ctx.me] })).filter((o) => o.startAt.getTime() <= ctx.now.getTime() && reportingFrom(maps, ctx.me, o.teamId))
  if (occs.length === 0) return null
  const rows = await tx.select().from(shiftReports).where(and(eq(shiftReports.tenantId, ctx.tenantId), eq(shiftReports.userId, ctx.me), gte(shiftReports.shiftDate, from), lte(shiftReports.shiftDate, to)))
  const byKey = new Map(rows.map((r) => [`${r.patternId}|${r.shiftDate}`, r]))
  const now = ctx.now.getTime()
  const latest = <T extends { startAt: Date }>(l: T[]): T | undefined => l.sort((a, b) => b.startAt.getTime() - a.startAt.getTime())[0]
  // the running shift, else the LAST ended one (a shift older than that is not offered: the member is not asked to file a week of nights); a last ended shift that was
  // already submitted or accepted has nothing left to do
  const pick = latest(occs.filter((o) => o.endAt.getTime() > now)) ?? latest(occs)
  if (!pick) return null
  const stored = byKey.get(`${pick.patternId}|${pick.shiftDate}`)
  if (pick.endAt.getTime() <= now && stored && (stored.status === "submitted" || stored.status === "accepted")) return null
  const r = stored
  const dueAt = r?.dueAt ?? new Date(dueInstant(pick.endAt.getTime(), await reportDueAfterMinutes(tx, ctx.tenantId)))
  const state = r ? stateOf(r, ctx.now) : now > dueAt.getTime() ? "missing" : "draft"
  return {
    key: `${ctx.me}:${pick.patternId}:${pick.shiftDate}`, shiftName: r?.shiftName ?? pick.name, shiftDate: pick.shiftDate,
    startAt: (r?.startAt ?? pick.startAt).toISOString(), endAt: (r?.endAt ?? pick.endAt).toISOString(), dueAt: dueAt.toISOString(), state, reportId: r?.id ?? null,
  }
}
