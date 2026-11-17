import { and, eq, sql } from "drizzle-orm"
import { EVIDENCE_TYPE_LABEL, fileType, isTypeAllowed, type EvidenceRule, type EvidenceType } from "@opsdesk/domain/task-evidence"
import { isDriveUrl } from "@opsdesk/domain/devices"
import { diffFields } from "@opsdesk/domain/task-history"
import { Conflict, Forbidden, NotFound } from "../../core/errors"
import { files, taskChecklistItems, taskEvidence, taskFiles, tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { expireFile } from "../files"
import {
  checkRule, evidenceDtos, getTask, loadEvidence, lockedTask, notifyTask, publishTaskEvent, staleVersion, taskDetailDto, unprocessable, writeHistory,
  type EvidenceDto, type TaskCtx, type TaskEnv,
} from "../tasks"
import type { z } from "@hono/zod-openapi"
import type { EvidenceBody } from "./dto"

const FILE_KINDS: EvidenceType[] = ["photo", "image", "pdf", "office", "video", "signature"]
/** Items can only be added while the assignee is working: not while a reviewer decides, and not after the task is closed. */
const ADDABLE = new Set(["not_started", "in_progress", "blocked", "changes_requested"])
const CAPTURE_AHEAD_MS = 5 * 60_000
const CAPTURE_BEHIND_MS = 30 * 24 * 60 * 60_000
const invalid = () => unprocessable("invalid_evidence")
const EvidenceNotFound = () => NotFound("evidence_not_found")

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com"])
const driveLink = (u: string): boolean => {
  try {
    const url = new URL(u)
    return (url.protocol === "https:" || url.protocol === "http:") && DRIVE_HOSTS.has(url.hostname) && isDriveUrl(u)
  } catch {
    return false
  }
}

/** The FE file-type test (`fileType`) against the declared kind: a photo, image or signature needs an image; the others need their own type. */
function mimeFits(kind: EvidenceType, name: string, mime: string): boolean {
  const t = fileType(name, mime, true)
  return kind === "photo" || kind === "image" || kind === "signature" ? t === "photo" || t === "image" : t === kind
}

/**
 * POST /v1/tasks/{id}/evidence (assignee or manager). Row lock first, so an add cannot interleave with Complete, verify or reject (a task that is
 * submitted, completed or cancelled takes no more items: 409 evidence_locked). `kind` must be allowed by the rule (422 evidence_type_not_allowed), then:
 *  - a file item names a `task_evidence` file of THIS task that the CALLER uploaded and nobody attached yet (anything else is the same 404 file_not_found,
 *    so another task's, another tenant's and another person's file look alike); the file row is held FOR SHARE so a scan verdict cannot slip past the
 *    insert. An infected file is 409 file_infected; a pending one is accepted and simply does not count until it is clean (ruling D10);
 *  - a note carries text; a drive item carries a Drive link and needs the Drive device policy (403 device_policy, ruling D22); a checklist item is
 *    a snapshot `Checklist n/m` the server counts from the task;
 *  - capture metadata: source (camera | upload), capturedAt (the client's claim, checked against the server clock) and the server-side device id.
 * No location is accepted anywhere (Q6). The item belongs to `ctx.me` (the creator for an API key), the same person the upload belongs to.
 */
export async function addEvidence(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: z.infer<typeof EvidenceBody>, deviceId: string | null): Promise<EvidenceDto> {
  const { row, manage, mine } = await lockedTask(tx, ctx, id, { onArchived: "conflict" })
  if (!manage && !mine) throw Forbidden("forbidden")
  if (!ADDABLE.has(row.status)) throw Conflict("evidence_locked")
  const rule = row.evidenceRule
  const kind = input.kind
  if (!isTypeAllowed(rule, kind)) throw unprocessable("evidence_type_not_allowed")
  if (kind === "drive" && !ctx.drive) throw Forbidden("device_policy") // checked on every request (FR-M0-10)

  const isFile = FILE_KINDS.includes(kind)
  if (isFile ? !input.fileId || input.text !== undefined || input.url !== undefined : input.fileId !== undefined || input.source !== undefined || input.capturedAt !== undefined) throw invalid()
  if (kind === "note" && (input.text === undefined || input.url !== undefined)) throw invalid()
  if (kind === "drive" && (input.url === undefined || input.text !== undefined || !driveLink(input.url))) throw invalid()
  if (kind === "checklist" && input.url !== undefined) throw invalid()
  let capturedAt: Date | null = null
  if (input.capturedAt) {
    capturedAt = new Date(input.capturedAt)
    const skew = capturedAt.getTime() - ctx.now.getTime()
    if (skew > CAPTURE_AHEAD_MS || -skew > CAPTURE_BEHIND_MS) throw unprocessable("invalid_captured_at")
  }

  let text: string | null = null
  if (kind === "note") text = input.text!
  if (kind === "checklist") {
    const [c] = await tx
      .select({ total: sql<number>`count(*)::int`, done: sql<number>`(count(*) filter (where ${taskChecklistItems.done}))::int` })
      .from(taskChecklistItems)
      .where(and(eq(taskChecklistItems.tenantId, ctx.tenantId), eq(taskChecklistItems.taskId, row.id)))
    if (c.total === 0) throw invalid()
    text = `Checklist ${c.done}/${c.total}`
  }
  if (isFile) {
    const [f] = await tx
      .select({ status: files.status, name: files.name, mime: files.mime })
      .from(taskFiles)
      .innerJoin(files, and(eq(files.tenantId, taskFiles.tenantId), eq(files.id, taskFiles.fileId)))
      .where(and(eq(taskFiles.tenantId, ctx.tenantId), eq(taskFiles.taskId, row.id), eq(taskFiles.fileId, input.fileId!), eq(taskFiles.purpose, "task_evidence"), eq(taskFiles.createdBy, ctx.me)))
      .for("share", { of: [files] })
    if (!f || f.status === "deleted") throw NotFound("file_not_found")
    if (f.status === "infected") throw Conflict("file_infected")
    if (!mimeFits(kind, f.name, f.mime)) throw invalid()
    const [taken] = await tx.select({ id: taskEvidence.id }).from(taskEvidence).where(and(eq(taskEvidence.tenantId, ctx.tenantId), eq(taskEvidence.fileId, input.fileId!)))
    if (taken) throw invalid() // one file, one item
  }

  const [item] = await tx
    .insert(taskEvidence)
    .values({
      tenantId: ctx.tenantId, taskId: row.id, round: row.round, kind, fileId: isFile ? input.fileId! : null, text, url: kind === "drive" ? input.url! : null,
      source: isFile ? (input.source ?? null) : null, capturedAt, deviceId, review: "pending", createdBy: ctx.me, createdAt: ctx.now,
    })
    .returning()
  await writeHistory(tx, ctx, row.id, { kind: "evidence", text: `Evidence added: ${EVIDENCE_TYPE_LABEL[kind]}` }) // the type only: no file name, text or link
  const [dto] = await evidenceDtos(tx, ctx, (await loadEvidence(tx, ctx.tenantId, [row.id])).get(row.id)!.filter((e) => e.id === item.id))
  await publishTaskEvent(tx, ctx, { type: "task.evidence_added", payload: { taskId: row.id, evidenceId: item.id } })
  return dto
}

/** DELETE /v1/tasks/{id}/evidence/{evidenceId}: only the uploader, only while unlocked (locked_at is set by Complete and by every review). Its file is expired. */
export async function deleteEvidence(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, evidenceId: string): Promise<void> {
  const { row } = await lockedTask(tx, ctx, id, { onArchived: "conflict" })
  const [e] = await tx
    .select()
    .from(taskEvidence)
    .where(and(eq(taskEvidence.tenantId, ctx.tenantId), eq(taskEvidence.taskId, row.id), eq(taskEvidence.id, evidenceId)))
    .for("update", { of: [taskEvidence] })
  if (!e) throw EvidenceNotFound()
  if (e.createdBy !== ctx.me) throw Forbidden("forbidden")
  if (e.lockedAt) throw Conflict("evidence_locked")
  await tx.delete(taskEvidence).where(and(eq(taskEvidence.tenantId, ctx.tenantId), eq(taskEvidence.id, e.id)))
  if (e.fileId) await expireFile(tx, ctx.tenantId, e.fileId, env.enqueue)
  await writeHistory(tx, ctx, row.id, { kind: "evidence", text: `Evidence removed: ${EVIDENCE_TYPE_LABEL[e.kind as EvidenceType]}` })
}

/**
 * PUT /v1/tasks/{id}/evidence-rule: the creator or a manager (403 forbidden), version checked (D4). The rule is judged strictly (checkRule: 422
 * invalid_evidence_rule / invalid_reviewer). Locked once the task is submitted, completed or cancelled (409 evidence_locked): a rule must not change
 * under a reviewer. Existing items are never re-judged against a new rule.
 */
export async function setEvidenceRule(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { version: number; rule: EvidenceRule }) {
  const { row, assignees, manage } = await lockedTask(tx, ctx, id, { onArchived: "conflict" })
  if (!manage && row.creatorId !== ctx.me) throw Forbidden("forbidden")
  staleVersion(row, input.version)
  if (["submitted", "completed", "cancelled"].includes(row.status)) throw Conflict("evidence_locked")
  const rule = await checkRule(tx, ctx, input.rule)
  const changes = diffFields({ evidenceRule: row.evidenceRule }, { evidenceRule: rule })
  if (changes.length === 0) return taskDetailDto(tx, ctx, row)
  const [next] = await tx.update(tasks).set({ evidenceRule: rule, version: row.version + 1, updatedAt: ctx.now }).where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId))).returning()
  const recipients = [...new Set([...assignees, ...(row.creatorId ? [row.creatorId] : [])])].filter((u) => u !== ctx.me && u !== ctx.actorId).sort()
  const historyId = await writeHistory(tx, ctx, row.id, { kind: "updated", text: "Updated Evidence", changes, notified: recipients })
  await notifyTask(tx, env, ctx, next, recipients, "Evidence requirements changed")
  const dto = await taskDetailDto(tx, ctx, next)
  await publishTaskEvent(tx, ctx, { type: "task.updated", payload: { taskId: row.id, historyId, fields: ["evidenceRule"] } }) // also re-indexes the task (a named reviewer sees it)
  return dto
}

/**
 * GET /v1/tasks/{id}/evidence/{evidenceId}/download: the TASK must be in scope first (404 task_not_found), then the item must be this task's (404
 * evidence_not_found). A file item returns the file id (the files module then applies the scan gate: 409 file_not_ready, 410 file_infected); a Drive item
 * returns its link, or 404 off the company PC; notes and checklists have nothing to download.
 */
export async function evidenceTarget(tx: TenantTx, ctx: TaskCtx, id: string, evidenceId: string): Promise<{ fileId: string } | { url: string }> {
  const task = await getTask(tx, ctx, id)
  const [e] = await tx.select().from(taskEvidence).where(and(eq(taskEvidence.tenantId, ctx.tenantId), eq(taskEvidence.taskId, task.id), eq(taskEvidence.id, evidenceId)))
  if (!e) throw EvidenceNotFound()
  if (e.fileId) return { fileId: e.fileId }
  if (e.kind === "drive" && e.url && ctx.drive) return { url: e.url }
  throw EvidenceNotFound()
}
