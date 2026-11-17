import { and, eq } from "drizzle-orm"
import { z } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { Forbidden, NotFound } from "../../core/errors"
import { subjectUserId } from "../../core/middleware/principal"
import { taskFiles } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { ALLOWED_MIMES, completeUpload, createUpload, taskFileDownloadUrl, TASK_VIDEO_MIMES, TASK_VOICE_MIMES, type UploadPolicy } from "../files"
import { allAssignees, assigneesOf } from "./repo"
import { canManage, getTask, loadTaskCtx, type TaskCtx } from "./scope"

export type TaskFilePurpose = UploadPolicy["purpose"]
/** The API words of the three purposes (ruling D9). */
export const UPLOAD_PURPOSES = { evidence: "task_evidence", attachment: "task_attachment", voice: "task_voice" } as const

const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
export const UploadBody = z
  .object({
    purpose: z.enum(["evidence", "attachment", "voice"]),
    name: z.string().min(1).max(255).regex(/^[^\u0000-\u001f\u007f]+$/, "no control characters"),
    mime: z.string().min(1).max(255),
    sizeBytes: z.number().int().min(1),
  })
  .openapi({ example: { purpose: "attachment", name: "floor-plan.pdf", mime: "application/pdf", sizeBytes: 482113 } })
export const UploadIntent = z
  .object({ fileId: z.string(), upload: z.object({ method: z.literal("PUT"), url: z.string(), headers: z.record(z.string(), z.string()) }) })
  .openapi({ example: { fileId: TID, upload: { method: "PUT", url: "https://<account_id>.r2.cloudflarestorage.com/<bucket>/u/<tenant>/<fileId>?X-Amz-...", headers: { "Content-Type": "application/pdf", "Content-Length": "482113" } } } })
export const TaskFileSchema = z
  .object({
    id: z.string(), name: z.string(), mime: z.string(), sizeBytes: z.number(), status: z.enum(["pending", "clean", "infected", "deleted"]), signature: z.string().nullable(),
    sha256: z.string().nullable(), ownerUserId: z.string().nullable(), createdAt: z.string(), scannedAt: z.string().nullable(),
  })
  .openapi({ example: { id: TID, name: "floor-plan.pdf", mime: "application/pdf", sizeBytes: 482113, status: "pending", signature: null, sha256: null, ownerUserId: "usr_8Kq2mZ4tW1", createdAt: "2026-11-20T10:00:00.000Z", scannedAt: null } })
export const FileParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: TID }),
  fileId: z.uuid().openapi({ param: { name: "fileId", in: "path" }, example: TID }),
})

const FileNotFound = () => NotFound("file_not_found")

/** Evidence = the B2 list + video; attachments = the B2 list; voice = the three audio types (ruling D21). */
function policyFor(c: Context<AppEnv>, purpose: TaskFilePurpose, lock: UploadPolicy["lock"], after?: UploadPolicy["after"]): UploadPolicy {
  const env = c.get("deps").env
  const base = { purpose, lock, after }
  if (purpose === "task_voice") return { ...base, mimes: TASK_VOICE_MIMES, maxBytes: () => env.TASK_VOICE_MAX_BYTES, stripMimeParams: true }
  if (purpose === "task_evidence") {
    const video = (TASK_VIDEO_MIMES as readonly string[])
    return { ...base, mimes: [...ALLOWED_MIMES, ...TASK_VIDEO_MIMES], maxBytes: (m) => (video.includes(m) ? env.TASK_VIDEO_MAX_BYTES : env.TASK_EVIDENCE_MAX_BYTES) }
  }
  return { ...base, mimes: ALLOWED_MIMES, maxBytes: () => env.FILE_MAX_BYTES }
}

/**
 * Who may put a file of this purpose on the task (403 forbidden otherwise; the task itself must be in the caller's scope first):
 * evidence = an assignee or a manager; attachment = assignee, manager or creator; voice = the creator or a manager (ruling D21).
 */
async function authorise(tx: TenantTx, ctx: TaskCtx, taskId: string, purpose: TaskFilePurpose): Promise<void> {
  const row = await getTask(tx, ctx, taskId, { forShare: true }) // held to commit: the task_files insert of the intent cannot meet a purge
  const assignees = allAssignees((await assigneesOf(tx, ctx.tenantId, [row.id])).get(row.id)!)
  const manage = canManage(ctx, row, assignees)
  const mine = assignees.includes(ctx.me)
  const creator = row.creatorId === ctx.me
  const ok = purpose === "task_evidence" ? manage || mine : purpose === "task_attachment" ? manage || mine || creator : manage || creator
  if (!ok) throw Forbidden("forbidden")
}

/** POST /v1/tasks/{id}/uploads (ruling D9): the B2 presign pipeline under a task policy, so it needs M1 + task access, not M4 + files:write. */
export async function taskUploadIntent(c: Context<AppEnv>, taskId: string, input: z.infer<typeof UploadBody>) {
  const purpose = UPLOAD_PURPOSES[input.purpose]
  let ctx: TaskCtx | undefined
  const policy = policyFor(
    c,
    purpose,
    async (tx) => {
      ctx = await loadTaskCtx(c, tx, "write") // actor lock first (R25), then the task checks
      await authorise(tx, ctx, taskId, purpose)
    },
    async (tx, fileId) => {
      await tx.insert(taskFiles).values({ fileId, tenantId: ctx!.tenantId, taskId, purpose, createdBy: ctx!.me, createdAt: ctx!.now })
    },
  )
  const tenantId = c.get("tenant")!.id
  return createUpload(c.get("deps"), tenantId, { userId: subjectUserId(c) }, { name: input.name, mime: input.mime, sizeBytes: input.sizeBytes }, policy)
}

/** The task file row of THIS task (404 task_not_found first, then 404 file_not_found: another task's file id looks like a missing one). */
async function taskFileOf(tx: TenantTx, ctx: TaskCtx, taskId: string, fileId: string) {
  const task = await getTask(tx, ctx, taskId)
  const [f] = await tx.select().from(taskFiles).where(and(eq(taskFiles.tenantId, ctx.tenantId), eq(taskFiles.taskId, task.id), eq(taskFiles.fileId, fileId)))
  if (!f) throw FileNotFound()
  return f
}

/** POST /v1/tasks/{id}/uploads/{fileId}/complete: idempotent, queues the scan (B2 completeUpload under the task policy). */
export async function completeTaskUpload(c: Context<AppEnv>, taskId: string, fileId: string) {
  const tenantId = c.get("tenant")!.id
  const deps = c.get("deps")
  const known = await withTenant(deps.db, tenantId, async (tx) => taskFileOf(tx, await loadTaskCtx(c, tx), taskId, fileId))
  const purpose = known.purpose as TaskFilePurpose
  const policy = policyFor(c, purpose, async (tx) => {
    const ctx = await loadTaskCtx(c, tx, "write")
    await authorise(tx, ctx, taskId, purpose)
    await taskFileOf(tx, ctx, taskId, fileId)
  })
  return completeUpload(deps, tenantId, { userId: subjectUserId(c) }, fileId, policy)
}

/** GET /v1/tasks/{id}/files/{fileId}/download: needs access to the TASK, then the scan gate; returns the 60 s presigned GET. */
export async function taskFileDownload(c: Context<AppEnv>, taskId: string, fileId: string): Promise<string> {
  const tenantId = c.get("tenant")!.id
  const f = await withTenant(c.get("deps").db, tenantId, async (tx) => taskFileOf(tx, await loadTaskCtx(c, tx), taskId, fileId))
  // A voice note is personal audio: it is served ONLY by GET /voice-note, which logs every play (ruling D21). Here it looks like a missing file.
  if (f.purpose === "task_voice") throw FileNotFound()
  return taskFileDownloadUrl(c.get("deps"), tenantId, fileId)
}
