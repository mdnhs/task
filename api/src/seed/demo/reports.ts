import { and, eq } from "drizzle-orm"
import { dueInstant, occurrenceInstants, type ShiftPattern } from "@opsdesk/domain/shifts"
import { shiftReportComments, shiftReportItems, shiftReportVersions, shiftReports, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { publishReportEvent } from "../../modules/shift-reports/events"
import type { Anchor } from "./anchor"
import { detId } from "./ids"
import type { MockPattern, MockReport } from "./source"

export type ReportWorld = {
  tenantId: string
  tz: string
  now: Date
  anchor: Anchor
  actorId: string
  dueAfterMinutes: number
  userOfMock: (pid: string) => string
  userOfName: (name: string) => string
  patternId: (mockId: string) => string
  teamId: (dept: string) => string
  pattern: (mockId: string) => MockPattern
  taskIds: Map<string, string>
}

const ITEM_STATUS = new Set(["done", "in_progress", "blocked", "not_started"])

/**
 * Inserts the mock's end-of-shift reports with their rows, frozen versions and reviewer comments. Raw inserts: the submit and review services stamp "now" and
 * act as a logged-in person, and a version row is append-only by design, so history cannot be replayed through them. The invariants are kept: one row per
 * (member, pattern, shift date), the shift instants and the due time computed ONCE from the pattern with the domain functions (F3), the task snapshot (ref, title, due)
 * in each row, a version per submission whose request id is deterministic, and a report event for every non-draft report so the search indexer finds it.
 * Report attachments are skipped (they are files; the seed writes no objects) and said so by the caller.
 */
export async function seedReports(tx: TenantTx, w: ReportWorld, mock: MockReport[]): Promise<{ attachmentsSkipped: number }> {
  let attachmentsSkipped = 0
  const events: { id: string; status: string; version: number; by: string }[] = []
  for (const r of mock) {
    const id = detId(w.tenantId, "report", r.id)
    const p = w.pattern(r.patternId)
    const date = w.anchor.day(r.date)
    const domainPattern: ShiftPattern = { id: p.id, name: p.name, team: p.team, start: p.start, end: p.end, days: p.days as ShiftPattern["days"], ...(p.timeZone ? { timeZone: p.timeZone } : {}) }
    const occ = occurrenceInstants(domainPattern, date, w.tz)
    const userId = w.userOfMock(r.personId)
    const versions = r.versions.length
    const reviewed = r.status === "accepted" || r.status === "returned"
    attachmentsSkipped += r.attachments.length
    await tx.insert(shiftReports).values({
      id, tenantId: w.tenantId, userId, patternId: w.patternId(r.patternId), shiftDate: date, teamId: w.teamId(p.team), shiftName: p.name,
      startAt: new Date(occ.startAt), endAt: new Date(occ.endAt), dueAt: new Date(dueInstant(occ.endAt, w.dueAfterMinutes)), status: r.status,
      summary: r.summary, blockers: r.blockers, unplanned: r.unplanned, extra: r.extra,
      firstSubmittedAt: versions ? w.anchor.instant(r.versions[0].at) : null, submittedAt: r.submittedAt ? w.anchor.instant(r.submittedAt) : null,
      reviewedAt: reviewed && r.reviewedAt ? w.anchor.instant(r.reviewedAt) : null, reviewedBy: reviewed && r.reviewedBy ? w.userOfName(r.reviewedBy) : null,
      version: Math.max(1, versions) + (reviewed ? 1 : 0), submissions: versions, createdAt: w.anchor.instant(r.createdAt), updatedAt: w.anchor.instant(r.updatedAt),
    })
    const items: { position: number; taskId: string | null; ref: number; title: string; dueAt: Date; status: string; minutes: number; note: string }[] = []
    for (const [position, i] of r.items.entries()) {
      const taskId = w.taskIds.get(i.taskRef) ?? null
      const [t] = taskId ? await tx.select({ title: tasks.title, dueAt: tasks.dueAt, refNo: tasks.refNo }).from(tasks).where(and(eq(tasks.tenantId, w.tenantId), eq(tasks.id, taskId))) : []
      if (!t) continue // a report row about a task the mock does not have: nothing to snapshot, so nothing to insert
      items.push({ position, taskId, ref: t.refNo, title: t.title, dueAt: t.dueAt, status: ITEM_STATUS.has(i.status) ? i.status : "not_started", minutes: i.minutes, note: i.note })
    }
    if (items.length) {
      await tx.insert(shiftReportItems).values(items.map((i) => ({ tenantId: w.tenantId, reportId: id, position: i.position, taskId: i.taskId, taskRef: i.ref, title: i.title, dueAt: i.dueAt, status: i.status, minutes: i.minutes, note: i.note })))
    }
    for (const v of r.versions) {
      await tx.insert(shiftReportVersions).values({
        id: detId(w.tenantId, "report-version", r.id, String(v.v)), tenantId: w.tenantId, reportId: id, v: v.v, at: w.anchor.instant(v.at), byUser: w.userOfName(v.by),
        requestId: detId(w.tenantId, "report-request", r.id, String(v.v)), note: v.note,
        snapshot: {
          summary: r.summary, blockers: r.blockers, unplanned: r.unplanned, extra: r.extra, attachmentFileIds: [],
          items: items.map((i) => ({ ref: `TSK-${i.ref}`, taskId: i.taskId, title: i.title, status: i.status, minutes: i.minutes, note: i.note, outcome: "applied" })),
        },
      })
    }
    for (const [n, c] of r.comments.entries()) {
      await tx.insert(shiftReportComments).values({ id: detId(w.tenantId, "report-comment", r.id, String(n)), tenantId: w.tenantId, reportId: id, at: w.anchor.instant(c.at), byUser: w.userOfName(c.by), kind: r.status === "returned" ? "return" : "accept", text: c.text })
    }
    if (r.status !== "draft") events.push({ id, status: r.status, version: Math.max(1, versions) + (reviewed ? 1 : 0), by: userId })
  }
  // events LAST: the report search indexer reads each report's final row
  for (const e of events) {
    const type = e.status === "accepted" ? "shift.report.accepted" : e.status === "returned" ? "shift.report.returned" : "shift.report.submitted"
    await publishReportEvent(tx, { tenantId: w.tenantId, actorId: w.actorId, now: w.now }, { type, payload: { reportId: e.id, version: e.version } })
  }
  return { attachmentsSkipped }
}
