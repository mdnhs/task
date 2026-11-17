import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm"
import { isDriveUrl, withholdDriveLinks, withholdDriveText } from "@opsdesk/domain/devices"
import { completeTarget, type EvidenceReview } from "@opsdesk/domain/task-evidence"
import { subscribe } from "../../core/events"
import { Conflict } from "../../core/errors"
import { files, taskEvidence, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { publishTaskEvent } from "./events"
import { namesOf, writeHistory } from "./history"
import type { TaskCtx, TaskRow } from "./scope"
import { wallOf } from "./time"

// Evidence data layer shared by the task lifecycle (complete / submit), the DTO and the review code (modules/task-evidence).
// Rulings D8 (independent review), D10 (only CLEAN files count; infected files are auto-rejected), D22 (Drive links).

export type EvidenceRow = typeof taskEvidence.$inferSelect
/** An item with its file's scan state (null for notes, checklists and Drive links). */
export type EvidenceView = EvidenceRow & { fileStatus: string | null; fileName: string | null; fileSize: number | null }

export const SCANNER = "system:scanner"
export const AUTO = "system:auto"
export const SCAN_REASON = "Failed malware scan"

const viewCols = {
  e: taskEvidence,
  fileStatus: files.status,
  fileName: files.name,
  fileSize: files.sizeBytes,
}

/** The items of tasks, oldest first, with their file state. `forUpdate` locks the ITEM rows in id order (after the task row, never before). */
export async function loadEvidence(tx: TenantTx, tenantId: string, taskIds: string[], o: { forUpdate?: boolean } = {}): Promise<Map<string, EvidenceView[]>> {
  const out = new Map<string, EvidenceView[]>(taskIds.map((id) => [id, []]))
  if (taskIds.length === 0) return out
  const q = tx
    .select(viewCols)
    .from(taskEvidence)
    .leftJoin(files, and(eq(files.tenantId, taskEvidence.tenantId), eq(files.id, taskEvidence.fileId)))
    .where(and(eq(taskEvidence.tenantId, tenantId), inArray(taskEvidence.taskId, taskIds)))
    .orderBy(asc(taskEvidence.createdAt), asc(taskEvidence.id))
  const rows = o.forUpdate ? await q.for("update", { of: [taskEvidence] }) : await q
  for (const r of rows) out.get(r.e.taskId)!.push({ ...r.e, fileStatus: r.fileStatus, fileName: r.fileName, fileSize: r.fileSize })
  return out
}

/** An item still in play: not rejected, and (when it has a file) the file is clean (ruling D10). Deleted and infected files never count. */
export const counts = (e: EvidenceView): boolean => e.review !== "rejected" && (e.fileId === null || e.fileStatus === "clean")

/** What `evidenceState` / `completeTarget` read: every rejected item (it explains "rejected") plus the items that count. Scanning or infected items are out. */
export const stateItems = (items: EvidenceView[]): { kind: string; review: EvidenceReview }[] =>
  items.filter((e) => e.review === "rejected" || counts(e)).map((e) => ({ kind: e.kind, review: e.review as EvidenceReview }))

// ---------- DTO ----------

export type EvidenceDto = {
  id: string; kind: string; name: string; by: string; at: string; review: "pending" | "accepted" | "rejected"; reason?: string; round: number; locked: boolean; source?: string
  capturedAt?: string; url?: string; size?: number; fileId?: string; fileStatus?: "pending" | "clean" | "infected" | "deleted"; reviewedBy?: string; reviewedAt?: string
}

/**
 * Items as the API returns them (FE `Evidence` shape + fileStatus, capturedAt, reviewedBy). A Drive link, and any Drive URL inside note text, is
 * withheld per request off the company PC (ruling D22): the stored value is untouched. One names lookup for the whole batch.
 */
export async function evidenceDtos(tx: TenantTx, ctx: Pick<TaskCtx, "tz" | "drive">, items: EvidenceView[]): Promise<EvidenceDto[]> {
  const nameOf = await namesOf(tx, items.flatMap((e) => [e.createdBy ?? "", e.reviewedBy ?? ""]).filter(Boolean))
  const dtos = items.map((e): EvidenceDto => {
    const name = e.fileId ? (e.fileName ?? "") : e.kind === "drive" ? (e.url ?? "") : (e.text ?? "")
    return {
      id: e.id, kind: e.kind, name, by: e.createdBy ? nameOf(e.createdBy) : "Former member", at: wallOf(e.createdAt, ctx.tz), review: e.review as EvidenceDto["review"],
      ...(e.reason ? { reason: ctx.drive ? e.reason : withholdDriveText(e.reason) } : {}), round: e.round, locked: e.lockedAt !== null,
      ...(e.source ? { source: e.source } : {}), ...(e.capturedAt ? { capturedAt: e.capturedAt.toISOString() } : {}),
      ...(e.kind === "drive" && e.url ? { url: e.url } : {}), ...(e.fileSize !== null ? { size: Number(e.fileSize) } : {}),
      ...(e.fileId ? { fileId: e.fileId } : {}), ...(e.fileStatus ? { fileStatus: e.fileStatus as NonNullable<EvidenceDto["fileStatus"]> } : {}),
      ...(e.reviewedBy ? { reviewedBy: nameOf(e.reviewedBy) } : {}), ...(e.reviewedAt ? { reviewedAt: wallOf(e.reviewedAt, ctx.tz) } : {}),
    }
  })
  if (ctx.drive) return dtos
  // the domain helper withholds Drive items and names that are a bare Drive URL; free text that merely CONTAINS a link goes through withholdDriveText
  const [safe] = withholdDriveLinks([{ evidence: dtos }])
  return safe.evidence.map((d) => ({ ...d, name: isDriveUrl(d.name) ? d.name : withholdDriveText(d.name) }))
}

// ---------- completion ----------

export type Settled = { target: "completed" | "submitted" | "blocked"; items: EvidenceView[]; infected: EvidenceView[] }

/**
 * Looks at the task's items (rows locked, in id order, AFTER the task row) and decides what Complete does (FR-M1-43/44, ruling D10):
 *  - any non-rejected item whose file is still `pending` → 409 evidence_not_ready (strict) or "blocked" (a shift report must never fail on it);
 *  - infected / deleted files never count; the target comes from completeTarget over the items that do;
 *  - infected pending items are returned so a SUCCESSFUL completion rejects them in the same tx (a blocked one raises, which rolls back; the
 *    file.scanned subscriber rejects them as soon as the event is relayed).
 */
export async function settleCompletion(tx: TenantTx, ctx: Pick<TaskCtx, "tenantId">, row: TaskRow, o: { strict: boolean }): Promise<Settled> {
  const items = (await loadEvidence(tx, ctx.tenantId, [row.id], { forUpdate: true })).get(row.id)!
  const live = items.filter((e) => e.review !== "rejected")
  if (live.some((e) => e.fileStatus === "pending")) {
    if (o.strict) throw Conflict("evidence_not_ready")
    return { target: "blocked", items, infected: [] }
  }
  const infected = live.filter((e) => e.fileStatus === "infected" && e.review === "pending")
  return { target: completeTarget(row.evidenceRule, stateItems(items)), items, infected }
}

/**
 * The evidence side of a successful Complete: infected items are rejected (reviewer system:scanner), a task that needs no review accepts its pending
 * items (reviewer system:auto, review mode "auto" only: "Not needed" tasks keep theirs pending), and every item still in play is locked (FR-M1-47).
 */
export async function applyCompletion(tx: TenantTx, ctx: Pick<TaskCtx, "tenantId" | "now">, row: TaskRow, s: Settled): Promise<void> {
  if (s.target === "blocked") return
  const now = ctx.now
  if (s.infected.length) await rejectItems(tx, ctx.tenantId, s.infected.map((e) => e.id), { by: SCANNER, reason: SCAN_REASON, at: now })
  const keep = s.items.filter(counts)
  const toAccept = s.target === "completed" && row.evidenceRule.mode !== "none" ? keep.filter((e) => e.review === "pending") : []
  if (toAccept.length) {
    await tx
      .update(taskEvidence)
      .set({ review: "accepted", reviewedBy: AUTO, reviewedAt: now })
      .where(and(eq(taskEvidence.tenantId, ctx.tenantId), inArray(taskEvidence.id, toAccept.map((e) => e.id)), eq(taskEvidence.review, "pending")))
  }
  const unlocked = keep.filter((e) => e.lockedAt === null).map((e) => e.id)
  if (unlocked.length) await tx.update(taskEvidence).set({ lockedAt: now }).where(and(eq(taskEvidence.tenantId, ctx.tenantId), inArray(taskEvidence.id, unlocked)))
}

/** Rejects still-pending items (a re-run or a race finds none to change). Locks them too: a rejected item is an earlier version for good. */
export async function rejectItems(tx: TenantTx, tenantId: string, ids: string[], d: { by: string; reason: string; at: Date }): Promise<void> {
  if (ids.length === 0) return
  await tx
    .update(taskEvidence)
    .set({ review: "rejected", reason: d.reason, reviewedBy: d.by, reviewedAt: d.at, lockedAt: d.at })
    .where(and(eq(taskEvidence.tenantId, tenantId), inArray(taskEvidence.id, ids), eq(taskEvidence.review, "pending")))
}

// ---------- the malware scan verdict ----------

/**
 * `file.scanned` { fileId, status } subscriber. An infected file auto-rejects its evidence item (ruling D10, reviewer system:scanner, reason "Failed
 * malware scan") and leaves a history line on the task. Lock order as everywhere: the task row first, then its item rows. Idempotent: an item
 * already decided is left alone. A purged task or a file that is no evidence at all is a no-op. No audit here: the scan verdict is already audited
 * by the files module (`file.infected`).
 */
export function registerEvidenceSubscriber(): void {
  try {
    subscribe("file.scanned", "tasks.evidence-scan-verdict", async (e, { tx }) => {
      if (e.payload.status !== "infected" || typeof e.payload.fileId !== "string") return
      const [hit] = await tx.select({ taskId: taskEvidence.taskId }).from(taskEvidence).where(and(eq(taskEvidence.tenantId, e.tenantId), eq(taskEvidence.fileId, e.payload.fileId)))
      if (!hit) return
      const [task] = await tx.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.tenantId, e.tenantId), eq(tasks.id, hit.taskId))).for("update", { of: [tasks] })
      if (!task) return // purged meanwhile
      const items = await tx
        .select({ id: taskEvidence.id, round: taskEvidence.round })
        .from(taskEvidence)
        .where(and(eq(taskEvidence.tenantId, e.tenantId), eq(taskEvidence.taskId, task.id), eq(taskEvidence.fileId, e.payload.fileId), eq(taskEvidence.review, "pending")))
        .orderBy(asc(taskEvidence.id))
        .for("update", { of: [taskEvidence] })
      if (items.length === 0) return
      await rejectItems(tx, e.tenantId, items.map((i) => i.id), { by: SCANNER, reason: SCAN_REASON, at: e.occurredAt })
      const who = { tenantId: e.tenantId, actorId: SCANNER, now: e.occurredAt }
      await writeHistory(tx, who, task.id, { kind: "evidence", text: "Evidence rejected: failed malware scan" })
      await publishTaskEvent(tx, who, { type: "task.evidence_rejected", payload: { taskId: task.id, evidenceIds: items.map((i) => i.id), round: items[0].round } })
    })
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("Duplicate event subscriber")) throw err
  }
}

// ---------- list filter ----------

export const EVIDENCE_FILTERS = ["verified", "awaiting", "rejected", "missing"] as const

/**
 * `GET /v1/tasks?evidence=` (FR-M1-48) as SQL on `tasks`, the same precedence as the domain `evidenceState`: submitted → awaiting; changes_requested
 * with a rejected item → rejected; Required below its minimum → missing (not once completed); every item in play accepted → verified. Items count
 * like `counts()`: not rejected, file clean. Correlated sub-selects over task_evidence_task_idx, evaluated only for rows the task indexes already return.
 */
export function evidenceFilter(state: (typeof EVIDENCE_FILTERS)[number]): SQL {
  const live = sql`(select count(*) from task_evidence e left join files f on f.tenant_id = e.tenant_id and f.id = e.file_id where e.tenant_id = ${tasks.tenantId} and e.task_id = ${tasks.id} and e.review <> 'rejected' and (e.file_id is null or f.status = 'clean'))`
  const unaccepted = sql`(select count(*) from task_evidence e left join files f on f.tenant_id = e.tenant_id and f.id = e.file_id where e.tenant_id = ${tasks.tenantId} and e.task_id = ${tasks.id} and e.review not in ('rejected', 'accepted') and (e.file_id is null or f.status = 'clean'))`
  const anyRejected = sql`exists (select 1 from task_evidence e where e.tenant_id = ${tasks.tenantId} and e.task_id = ${tasks.id} and e.review = 'rejected')`
  const rejectedState = sql`(${tasks.status} = 'changes_requested' and ${anyRejected})`
  const short = sql`(${tasks.evidenceRule}->>'mode' = 'required' and ${live} < (${tasks.evidenceRule}->>'min')::int)`
  if (state === "awaiting") return sql`${tasks.status} = 'submitted'`
  if (state === "rejected") return rejectedState
  if (state === "missing") return sql`(${tasks.status} not in ('cancelled', 'completed', 'submitted') and not ${rejectedState} and ${short})`
  return sql`(${tasks.status} not in ('cancelled', 'submitted') and not ${rejectedState} and not ${short} and ${live} > 0 and ${unaccepted} = 0)`
}
