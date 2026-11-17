import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { epochToWall } from "@opsdesk/domain/shifts"
import { evidenceState, type EvidenceRule } from "@opsdesk/domain/task-evidence"
import { files, shiftReportComments, shiftReportFiles, shiftReportItems, shiftReportVersions, tasks, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { loadEvidence, namesOf, stateItems } from "../tasks"
import type { ReportAttachmentDto, ReportDto, ReportItemDto, VersionDto } from "./dto"
import type { ReportCtx, ReportRow } from "./scope"

type ViewCtx = Pick<ReportCtx, "tenantId" | "tz" | "drive" | "now">

const FORMER = "Former member"
const wall = (d: Date, tz: string): string => epochToWall(d.getTime(), tz)

/** The shown state (FR-M1-28, FR-M1-30) from instants: accepted and returned as stored; submitted is "late" when the FIRST submission came after the due time; a draft is "missing" past it. */
export function stateOf(r: Pick<ReportRow, "status" | "firstSubmittedAt" | "dueAt">, now: Date): ReportDto["state"] {
  if (r.status === "accepted" || r.status === "returned") return r.status
  if (r.status === "submitted") return r.firstSubmittedAt && r.firstSubmittedAt.getTime() > r.dueAt.getTime() ? "late" : "submitted"
  return now.getTime() > r.dueAt.getTime() ? "missing" : "draft"
}

/** Every string leaf of a JSON value, withheld per request (ruling D22 / F10): a Drive link never reaches a device without Drive access. Keys are never touched. */
export function withholdDeep<T>(v: T, drive: boolean): T {
  if (drive) return v
  const walk = (x: unknown): unknown => (typeof x === "string" ? withholdDriveText(x) : Array.isArray(x) ? x.map(walk) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, val]) => [k, walk(val)])) : x)
  return walk(v) as T
}

type Snapshot = { items?: { ref?: string; outcome?: ReportItemDto["outcome"] }[] }

/** Report DTOs for a batch of rows (one query per table, never per report): rows with live task state and evidence state, attachments, comments, the last submit's outcomes. */
export async function reportDtos(tx: TenantTx, ctx: ViewCtx, rows: ReportRow[]): Promise<ReportDto[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.id)
  const free = (s: string) => (ctx.drive ? s : withholdDriveText(s))
  const items = await tx.select().from(shiftReportItems).where(and(eq(shiftReportItems.tenantId, ctx.tenantId), inArray(shiftReportItems.reportId, ids))).orderBy(asc(shiftReportItems.reportId), asc(shiftReportItems.position))
  const taskIds = [...new Set(items.flatMap((i) => (i.taskId ? [i.taskId] : [])))]
  const live = taskIds.length ? await tx.select({ id: tasks.id, status: tasks.status, rule: tasks.evidenceRule }).from(tasks).where(and(eq(tasks.tenantId, ctx.tenantId), inArray(tasks.id, taskIds))) : []
  const liveBy = new Map(live.map((t) => [t.id, t]))
  const evidence = await loadEvidence(tx, ctx.tenantId, [...liveBy.keys()])
  const teamRows = await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, [...new Set(rows.map((r) => r.teamId))])))
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]))
  const att = await tx
    .select({ reportId: shiftReportFiles.reportId, id: files.id, name: files.name, mime: files.mime, size: files.sizeBytes, status: files.status, at: files.createdAt })
    .from(shiftReportFiles)
    .innerJoin(files, and(eq(files.tenantId, shiftReportFiles.tenantId), eq(files.id, shiftReportFiles.fileId)))
    .where(and(eq(shiftReportFiles.tenantId, ctx.tenantId), inArray(shiftReportFiles.reportId, ids)))
    .orderBy(asc(files.createdAt), asc(files.id))
  const comments = await tx.select().from(shiftReportComments).where(and(eq(shiftReportComments.tenantId, ctx.tenantId), inArray(shiftReportComments.reportId, ids))).orderBy(asc(shiftReportComments.at), asc(shiftReportComments.id))
  const versions = await tx
    .select({ reportId: shiftReportVersions.reportId, v: shiftReportVersions.v, snapshot: shiftReportVersions.snapshot })
    .from(shiftReportVersions)
    .where(and(eq(shiftReportVersions.tenantId, ctx.tenantId), inArray(shiftReportVersions.reportId, ids)))
    .orderBy(desc(shiftReportVersions.v))
  const lastSnapshot = new Map<string, Snapshot>()
  for (const v of versions) if (!lastSnapshot.has(v.reportId)) lastSnapshot.set(v.reportId, v.snapshot as Snapshot)
  const nameOf = await namesOf(tx, rows.flatMap((r) => [r.reviewedBy ?? ""]).concat(comments.flatMap((c) => [c.byUser ?? ""])).filter(Boolean))

  return rows.map((r): ReportDto => {
    const outcomes = new Map((lastSnapshot.get(r.id)?.items ?? []).map((i) => [i.ref, i.outcome]))
    return {
      id: r.id,
      key: `${r.userId ?? "former"}:${r.patternId}:${r.shiftDate}`,
      userId: r.userId,
      patternId: r.patternId,
      shiftName: free(r.shiftName),
      team: free(teamName.get(r.teamId) ?? ""),
      date: r.shiftDate,
      start: wall(r.startAt, ctx.tz), end: wall(r.endAt, ctx.tz), due: wall(r.dueAt, ctx.tz),
      startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString(), dueAt: r.dueAt.toISOString(),
      status: r.status as ReportDto["status"],
      state: stateOf(r, ctx.now),
      version: r.version,
      submissions: r.submissions,
      items: items.filter((i) => i.reportId === r.id).map((i): ReportItemDto => {
        const t = i.taskId ? liveBy.get(i.taskId) : undefined
        const ref = `TSK-${i.taskRef}`
        const outcome = outcomes.get(ref)
        return {
          position: i.position, taskId: i.taskId, ref, title: free(i.title), due: wall(i.dueAt, ctx.tz), dueAt: i.dueAt.toISOString(), status: i.status as ReportItemDto["status"], minutes: i.minutes, note: free(i.note),
          taskStatus: t?.status ?? null,
          evidenceState: t ? evidenceState(t.rule as EvidenceRule, stateItems(evidence.get(t.id) ?? []), t.status) : null,
          ...(outcome ? { outcome } : {}),
        }
      }),
      summary: free(r.summary), blockers: free(r.blockers),
      unplanned: r.unplanned.map((u) => ({ id: u.id, text: free(u.text), minutes: u.minutes })),
      extra: Object.fromEntries(Object.entries(r.extra).map(([k, v]) => [k, free(v)])),
      attachments: att.filter((a) => a.reportId === r.id && a.status !== "deleted").map((a): ReportAttachmentDto => ({ id: a.id, name: free(a.name), kind: a.mime.startsWith("image/") ? "image" : "file", size: a.size, status: a.status as ReportAttachmentDto["status"] })),
      submittedAt: r.submittedAt?.toISOString() ?? null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewedBy: r.reviewedBy ? nameOf(r.reviewedBy) : null,
      comments: comments.filter((c) => c.reportId === r.id).map((c) => ({ at: c.at.toISOString(), by: c.byUser ? nameOf(c.byUser) : FORMER, text: free(c.text) })),
    }
  })
}

/** The frozen submissions of a report, oldest first (`GET …/versions`); every string of a snapshot is withheld per request. `by` is the display name now. */
export async function versionDtos(tx: TenantTx, ctx: ViewCtx, reportId: string): Promise<VersionDto[]> {
  const rows = await tx.select().from(shiftReportVersions).where(and(eq(shiftReportVersions.tenantId, ctx.tenantId), eq(shiftReportVersions.reportId, reportId))).orderBy(asc(shiftReportVersions.v))
  const nameOf = await namesOf(tx, rows.flatMap((v) => (v.byUser ? [v.byUser] : [])))
  return rows.map((v) => ({ v: v.v, at: v.at.toISOString(), by: v.byUser ? nameOf(v.byUser) : FORMER, note: v.note, snapshot: withholdDeep(v.snapshot, ctx.drive) }))
}
