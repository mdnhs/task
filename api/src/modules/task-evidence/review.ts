import { and, eq, inArray } from "drizzle-orm"
import { canVerify, missingEvidence } from "@opsdesk/domain/task-evidence"
import { STATUS, type TaskStatus } from "@opsdesk/domain/task-model"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { taskComments, taskEvidence, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import {
  counts, loadEvidence, lockedTask, notifyTask, publishTaskEvent, rejectItems, SCAN_REASON, SCANNER, staleVersion, stateItems, taskDetailDto, writeHistory,
  type EvidenceView, type TaskCtx, type TaskDto, type TaskEnv,
} from "../tasks"

type Op = "verify" | "reject"
type Input = { version: number; evidenceIds?: string[]; reason?: string }
const ref = (n: number) => `TSK-${n}`

/**
 * Verify or reject the evidence of ONE submitted task. Verification is a personal attestation (ruling D8), so the checks run in this order, all under
 * the task row lock (actor lock before it, item rows after it) and before anything is written:
 *   1. any assignee of the task, primary or co-assignee, managers included → 403 self_verification;
 *   2. the items this call targets (`evidenceIds`, or every pending item of the current round); an id that is not this task's → 404 evidence_not_found;
 *   3. the uploader of ANY targeted item → 403 self_verification;
 *   4. `canVerify` (managers always; the creator in creator mode; the named reviewer in named mode) else 403 not_a_reviewer;
 *   5. `version` (409 version_conflict), then the state: the task must be `submitted` and every targeted item pending, with a clean file
 *      (409 invalid_transition / evidence_not_ready). Two reviewers racing meet at the row lock: the second sees a new version or a closed task.
 * Then: write, history, notify the assignees, audit (ids only), events LAST. Infected pending items nobody targets are rejected by the scanner on the way.
 * The caller has already refused API keys (403 human_required).
 */
export async function decide(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, taskId: string, op: Op, input: Input): Promise<TaskDto> {
  const { row, people, assignees, manage } = await lockedTask(tx, ctx, taskId, { onArchived: "conflict" })
  if (assignees.includes(ctx.me)) throw Forbidden("self_verification")
  const items = (await loadEvidence(tx, ctx.tenantId, [row.id], { forUpdate: true })).get(row.id)!
  let targeted: EvidenceView[]
  if (input.evidenceIds) {
    const want = new Set(input.evidenceIds)
    targeted = items.filter((e) => want.has(e.id))
    if (targeted.length !== want.size) throw NotFound("evidence_not_found")
  } else {
    targeted = items.filter((e) => e.review === "pending" && e.round === row.round && e.fileStatus !== "infected")
  }
  if (targeted.some((e) => e.createdBy === ctx.me)) throw Forbidden("self_verification")
  if (!canVerify(row.evidenceRule, { id: ctx.me, manager: manage }, { creator: row.creatorId ?? "", assignee: people.primary ?? "", assignees })) throw Forbidden("not_a_reviewer")
  staleVersion(row, input.version)
  if (row.status !== "submitted" || targeted.length === 0 || targeted.some((e) => e.review !== "pending")) throw Conflict("invalid_transition")
  if (targeted.some((e) => e.fileId && e.fileStatus !== "clean")) throw Conflict("evidence_not_ready")

  const now = ctx.now
  const ids = targeted.map((e) => e.id).sort()
  const picked = new Set(ids)
  const infected = items.filter((e) => e.review === "pending" && e.fileStatus === "infected" && !picked.has(e.id))
  await rejectItems(tx, ctx.tenantId, infected.map((e) => e.id), { by: SCANNER, reason: SCAN_REASON, at: now })
  const left = items.filter((e) => counts(e) && e.review === "pending" && !picked.has(e.id)) // still waiting for a reviewer after this call

  let to: TaskStatus = "submitted"
  let round = row.round
  if (op === "verify") {
    await tx.update(taskEvidence).set({ review: "accepted", reviewedBy: ctx.me, reviewedAt: now, lockedAt: now }).where(and(eq(taskEvidence.tenantId, ctx.tenantId), inArray(taskEvidence.id, ids), eq(taskEvidence.review, "pending")))
    if (left.length === 0) {
      // everything in play is decided. Normally that closes the task; if rejected scans left it short of its minimum, it goes back instead of waiting for nobody
      const after = items.map((e) => (picked.has(e.id) ? { ...e, review: "accepted" as const } : e))
      to = missingEvidence(row.evidenceRule, stateItems(after)) === 0 ? "completed" : "changes_requested"
    }
  } else {
    await tx.update(taskEvidence).set({ review: "rejected", reason: input.reason!, reviewedBy: ctx.me, reviewedAt: now, lockedAt: now }).where(and(eq(taskEvidence.tenantId, ctx.tenantId), inArray(taskEvidence.id, ids), eq(taskEvidence.review, "pending")))
    to = "changes_requested"
  }
  if (to === "changes_requested") {
    round = row.round + 1
    // untouched pending items move to the new round, unlocked: the assignee may still replace them
    if (left.length) await tx.update(taskEvidence).set({ round, lockedAt: null }).where(and(eq(taskEvidence.tenantId, ctx.tenantId), inArray(taskEvidence.id, left.map((e) => e.id))))
  }

  const moved = to !== row.status
  const [next] = await tx
    .update(tasks)
    .set({
      version: row.version + 1, updatedAt: now, round,
      ...(moved ? { status: to, submittedAt: to === "completed" ? row.submittedAt : null, completedAt: to === "completed" ? now : null } : {}), // a verified task keeps its submit moment (lateness)
    })
    .where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId)))
    .returning()
  if (op === "reject") {
    // the reason is the reviewer's note to the assignee: a comment on the task (it never enters history, audit or events)
    await tx.insert(taskComments).values({ tenantId: ctx.tenantId, taskId: row.id, authorId: ctx.actorId, body: `Evidence rejected: ${input.reason}`, mentions: [], attachmentFileIds: [], createdAt: now })
  }
  const recipients = assignees.filter((u) => u !== ctx.me && u !== ctx.actorId).sort()
  const verb = op === "verify" ? "verified" : "rejected"
  await writeHistory(tx, ctx, row.id, {
    kind: verb, text: `Evidence ${verb}${moved ? ` (${STATUS[to].label})` : ""}`, changes: moved ? [{ field: "status", from: row.status, to }] : [], notified: recipients,
  })
  await notifyTask(tx, env, ctx, next, recipients, op === "verify" ? "Evidence verified" : "Evidence rejected")
  await recordAudit(tx, ctx.tenantId, {
    action: op === "verify" ? "task.evidence_verified" : "task.evidence_rejected", entity: "task", entityId: row.id, actorId: ctx.actorId,
    before: { ref: ref(row.refNo), status: row.status }, after: { ref: ref(row.refNo), status: next.status, evidenceIds: ids },
  }, now)
  const dto = await taskDetailDto(tx, ctx, next)
  await publishTaskEvent(tx, ctx, op === "verify" ? { type: "task.evidence_verified", payload: { taskId: row.id, evidenceIds: ids } } : { type: "task.evidence_rejected", payload: { taskId: row.id, evidenceIds: ids, round: row.round } })
  if (to === "completed") await publishTaskEvent(tx, ctx, { type: "task.completed", payload: { taskId: row.id } })
  else if (moved) await publishTaskEvent(tx, ctx, { type: "task.status_changed", payload: { taskId: row.id, from: row.status as TaskStatus, to } })
  return dto
}

export type BatchItem = { taskId: string; version: number; evidenceIds?: string[] }
export type BatchOutcome = { taskId: string; status: "verified" | "failed"; code?: string }

/**
 * POST /v1/evidence/verify-batch: each item is its own savepoint, so one that is refused (self_verification, a stale version, a task out of scope...)
 * rolls back alone and the others stay. Tasks are decided in id order (never request order), so two overlapping batches cannot deadlock; the result
 * keeps the request order. Only an AppError is reported per item: anything else is a bug and fails the whole call.
 */
export async function verifyBatch(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, items: BatchItem[]): Promise<BatchOutcome[]> {
  const out: BatchOutcome[] = new Array(items.length)
  const order = items.map((_, i) => i).sort((a, b) => (items[a].taskId < items[b].taskId ? -1 : items[a].taskId > items[b].taskId ? 1 : a - b))
  for (const i of order) {
    const it = items[i]
    try {
      await tx.transaction(async (sp) => {
        await decide(sp as unknown as TenantTx, env, ctx, it.taskId, "verify", it)
      })
      out[i] = { taskId: it.taskId, status: "verified" }
    } catch (e) {
      if (!(e instanceof AppError)) throw e
      out[i] = { taskId: it.taskId, status: "failed", code: e.code }
    }
  }
  return out
}
