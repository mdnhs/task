import { and, desc, eq, isNull, or, sql } from "drizzle-orm"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { wallToEpoch } from "@opsdesk/domain/shifts"
import { files, taskEvidence, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { decodeCursor, encodeCursor, evidenceDtos, taskScopeWhere, type EvidenceView, type TaskCtx } from "../tasks"
import type { GalleryFilter } from "./dto"

const REVIEW = { awaiting: "pending", verified: "accepted", rejected: "rejected" } as const
const ref = (n: number) => `TSK-${n}`

/**
 * The gallery statement (FR-M1-49), exported so the EXPLAIN test plans the exact query: items of live tasks IN THE CALLER'S SCOPE (the same predicate as the
 * task list), newest first, keyset on (created_at, id) behind task_evidence_gallery_idx (tenant_id, review, created_at, id). "Awaiting" means pending on a
 * SUBMITTED task whose file (if any) is clean; the other states are the review decision. The day is a tenant-local calendar day.
 */
export function galleryQuery(tx: TenantTx, ctx: Pick<TaskCtx, "tenantId" | "tz" | "scope" | "reports">, f: Partial<GalleryFilter>, after: { at: Date; id: string } | null, take: number) {
  const state = f.state ?? "awaiting"
  const day = f.date
  const start = day ? new Date(wallToEpoch(`${day}T00:00:00`, ctx.tz)) : null
  const next = day ? new Date(wallToEpoch(`${new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)}T00:00:00`, ctx.tz)) : null
  return tx
    .select({
      e: taskEvidence, fileStatus: files.status, fileName: files.name, fileSize: files.sizeBytes,
      taskRef: tasks.refNo, taskTitle: tasks.title, taskStatus: tasks.status,
    })
    .from(taskEvidence)
    .innerJoin(tasks, and(eq(tasks.tenantId, taskEvidence.tenantId), eq(tasks.id, taskEvidence.taskId)))
    .leftJoin(files, and(eq(files.tenantId, taskEvidence.tenantId), eq(files.id, taskEvidence.fileId)))
    .where(
      and(
        eq(taskEvidence.tenantId, ctx.tenantId), eq(taskEvidence.review, REVIEW[state]), isNull(tasks.archivedAt), taskScopeWhere(ctx.scope, ctx.reports),
        state === "awaiting" ? and(eq(tasks.status, "submitted"), or(isNull(taskEvidence.fileId), eq(files.status, "clean"))) : undefined,
        f.teamId ? eq(tasks.teamId, f.teamId) : undefined,
        start && next ? sql`(${taskEvidence.createdAt} >= ${start.toISOString()}::timestamptz and ${taskEvidence.createdAt} < ${next.toISOString()}::timestamptz)` : undefined,
        after ? sql`(${taskEvidence.createdAt}, ${taskEvidence.id}) < (${after.at.toISOString()}::timestamptz, ${after.id}::uuid)` : undefined,
      ),
    )
    .orderBy(desc(taskEvidence.createdAt), desc(taskEvidence.id))
    .limit(take)
}

/** GET /v1/evidence: one query for the page, one names lookup; Drive links are withheld off the company PC (ruling D22). */
export async function gallery(tx: TenantTx, ctx: TaskCtx, q: GalleryFilter & { limit: number; cursor?: string }) {
  const rows = await galleryQuery(tx, ctx, q, q.cursor ? decodeCursor(q.cursor) : null, q.limit + 1)
  const page = rows.slice(0, q.limit)
  const views: EvidenceView[] = page.map((r) => ({ ...r.e, fileStatus: r.fileStatus, fileName: r.fileName, fileSize: r.fileSize }))
  const dtos = await evidenceDtos(tx, ctx, views)
  const last = page[page.length - 1]
  return {
    items: dtos.map((d, i) => ({
      ...d, taskId: page[i].e.taskId, taskRef: ref(page[i].taskRef), taskTitle: ctx.drive ? page[i].taskTitle : withholdDriveText(page[i].taskTitle), taskStatus: page[i].taskStatus,
    })),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.e.createdAt, last.e.id) : null,
  }
}
