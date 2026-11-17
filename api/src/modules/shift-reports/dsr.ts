import { and, asc, eq, inArray, sql } from "drizzle-orm"
import { shiftReportComments, shiftReportFiles, shiftReportItems, shiftReportVersions, shiftReports } from "../../db/schema"
import { expireFile } from "../files"
import type { DsrHandler } from "../gdpr/registry"
import { removeDocument } from "../search/service"

export const ERASED_TEXT = "[erased]"
const erased = (s: string): string => (s.length ? ERASED_TEXT : s)

/** Every string value of a JSON tree replaced by "[erased]"; keys, numbers, booleans and ids that are not free text are kept (a version snapshot holds counts and refs, not a person). */
const SNAPSHOT_TEXT = new Set(["summary", "blockers", "text", "note"])
function scrub(v: unknown, key = ""): unknown {
  if (typeof v === "string") return SNAPSHOT_TEXT.has(key) ? erased(v) : v
  if (Array.isArray(v)) return v.map((x) => scrub(x, key))
  if (v && typeof v === "object") {
    if (key === "extra") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? erased(x) : x]))
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, k)]))
  }
  return v
}

/**
 * Data-subject requests for shift reports (FR-M0-18, ruling F22). Export: the subject's reports (with rows, versions and attachment names) and the comments they wrote.
 * Erase (runs BEFORE the membership is removed, in the same tx): the free text of their reports, rows, unplanned work, extra answers and version snapshots is replaced by
 * "[erased]" (counts, refs, status and times stay: the manager keeps the record, not the narrative), their attachments are expired (object removal queued), the `by_user`
 * links of the versions and comments they wrote are nulled; the report's own `user_id` becomes NULL when the membership is deleted (composite FK ON DELETE SET NULL, run
 * as the table owner), and `shift_assignments` / `shift_reporting_people` go with the membership (FK cascade). Idempotent: a re-run finds nothing to change.
 */
export const shiftReportsDsrHandler: DsrHandler = {
  async export(tx, tenantId, userId) {
    const reports = await tx.select().from(shiftReports).where(and(eq(shiftReports.tenantId, tenantId), eq(shiftReports.userId, userId))).orderBy(asc(shiftReports.shiftDate), asc(shiftReports.id))
    const ids = reports.map((r) => r.id)
    const items = ids.length ? await tx.select().from(shiftReportItems).where(and(eq(shiftReportItems.tenantId, tenantId), inArray(shiftReportItems.reportId, ids))).orderBy(asc(shiftReportItems.reportId), asc(shiftReportItems.position)) : []
    const versions = ids.length ? await tx.select().from(shiftReportVersions).where(and(eq(shiftReportVersions.tenantId, tenantId), inArray(shiftReportVersions.reportId, ids))).orderBy(asc(shiftReportVersions.reportId), asc(shiftReportVersions.v)) : []
    const comments = await tx.select().from(shiftReportComments).where(and(eq(shiftReportComments.tenantId, tenantId), eq(shiftReportComments.byUser, userId))).orderBy(asc(shiftReportComments.at), asc(shiftReportComments.id))
    return {
      reports: reports.map((r) => ({
        id: r.id, shiftName: r.shiftName, shiftDate: r.shiftDate, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString(), dueAt: r.dueAt.toISOString(), status: r.status, version: r.version, submissions: r.submissions,
        summary: r.summary, blockers: r.blockers, unplanned: r.unplanned, extra: r.extra, submittedAt: r.submittedAt?.toISOString() ?? null,
        items: items.filter((i) => i.reportId === r.id).map((i) => ({ ref: `TSK-${i.taskRef}`, title: i.title, status: i.status, minutes: i.minutes, note: i.note })),
        versions: versions.filter((v) => v.reportId === r.id).map((v) => ({ v: v.v, at: v.at.toISOString(), note: v.note, snapshot: v.snapshot })),
      })),
      comments: comments.map((c) => ({ id: c.id, reportId: c.reportId, at: c.at.toISOString(), kind: c.kind, text: c.text })),
    }
  },
  async erase(tx, tenantId, userId, now, enqueue) {
    // the subject's reports, locked in id order (a submit of the same report finishes first)
    const mine = await tx.select().from(shiftReports).where(and(eq(shiftReports.tenantId, tenantId), eq(shiftReports.userId, userId))).orderBy(asc(shiftReports.id)).for("update", { of: [shiftReports] })
    for (const r of mine) {
      await tx
        .update(shiftReports)
        .set({
          summary: erased(r.summary), blockers: erased(r.blockers), unplanned: r.unplanned.map((u) => ({ ...u, text: erased(u.text) })), extra: Object.fromEntries(Object.entries(r.extra).map(([k, v]) => [k, erased(v)])),
          updatedAt: now,
        })
        .where(and(eq(shiftReports.id, r.id), eq(shiftReports.tenantId, tenantId)))
    }
    const ids = mine.map((r) => r.id)
    for (const id of ids) await removeDocument(tx, tenantId, "report", id) // the shift name and date of an erased member's report are no longer searchable
    if (ids.length) {
      await tx.update(shiftReportItems).set({ note: sql`case when ${shiftReportItems.note} = '' then '' else ${ERASED_TEXT} end` }).where(and(eq(shiftReportItems.tenantId, tenantId), inArray(shiftReportItems.reportId, ids)))
      const vs = await tx.select({ id: shiftReportVersions.id, snapshot: shiftReportVersions.snapshot }).from(shiftReportVersions).where(and(eq(shiftReportVersions.tenantId, tenantId), inArray(shiftReportVersions.reportId, ids))).orderBy(asc(shiftReportVersions.id))
      for (const v of vs) await tx.update(shiftReportVersions).set({ snapshot: scrub(v.snapshot) as object }).where(and(eq(shiftReportVersions.id, v.id), eq(shiftReportVersions.tenantId, tenantId)))
      const fs = await tx.select({ fileId: shiftReportFiles.fileId }).from(shiftReportFiles).where(and(eq(shiftReportFiles.tenantId, tenantId), inArray(shiftReportFiles.reportId, ids))).orderBy(asc(shiftReportFiles.fileId))
      for (const f of fs) await expireFile(tx, tenantId, f.fileId, enqueue ?? (() => {})) // without a queue the hourly retention sweep re-queues the object removal
    }
    // the version and comment authors, and the uploader link of files the subject put on anybody's report
    await tx.update(shiftReportVersions).set({ byUser: null }).where(and(eq(shiftReportVersions.tenantId, tenantId), eq(shiftReportVersions.byUser, userId)))
    await tx.update(shiftReportComments).set({ byUser: null }).where(and(eq(shiftReportComments.tenantId, tenantId), eq(shiftReportComments.byUser, userId)))
    await tx.update(shiftReportFiles).set({ userId: null }).where(and(eq(shiftReportFiles.tenantId, tenantId), eq(shiftReportFiles.userId, userId)))
    await tx.update(shiftReports).set({ reviewedBy: null }).where(and(eq(shiftReports.tenantId, tenantId), eq(shiftReports.reviewedBy, userId)))
  },
}
