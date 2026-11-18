import { and, desc, eq, lt, or } from "drizzle-orm"
import { z } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { actorIdOf } from "../../core/middleware/principal"
import { files, taskFiles, taskVoiceAccess, tasks } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { DOWNLOAD_TTL_SEC, expireFile, TASK_VOICE_MIMES } from "../files"
import { withTenantAfterCommit } from "../notifications"
import { decodeCursor, encodeCursor } from "../../core/cursor"
import { Version, type TaskDto } from "./dto"
import { publishTaskEvent } from "./events"
import { namesOf, writeHistory } from "./history"
import { changeRecipients, notifyTask, type TaskEnv } from "./notify"
import { allAssignees, assigneesOf } from "./repo"
import { canManage, getTask, loadTaskCtx, type TaskCtx } from "./scope"
import { lockedTask, staleVersion, taskDetailDto, unprocessable } from "./service"
import { wallOf } from "./time"
import { lockTaskPurge, voiceFileStillReferenced } from "./voice-refs"

// Voice instructions (ruling D21, change request 30 Oct 2026). A voice note is personal audio, so:
//  - it is NEVER sent to an AI or transcription provider: this module (and voice-routes.ts, voice-refs.ts) imports nothing of the kind and enqueues
//    no job itself; the only jobs a voice file ever gets are `file.scan` (B2 upload completion) and `file.delete-object` (expireFile). A test pins both.
//  - every play is logged (`task_voice_access`) in the SAME tx that signs the 60 s URL, so a URL cannot exist without its log row. Who may read the log:
//    the managers of the task only (canManage); an assignee or creator who is not a manager gets 403, anyone out of scope 404. The log never appears in
//    a task DTO or in task history.
//  - the generic task file download refuses `task_voice` files (uploads.ts), so the voice route is the only way to the bytes.
//
// DECISIONS (each one documented where the code is):
//  * Set / replace / clear change `voice_file_id`/`voice_meta`, which are task columns, so they follow D4: `version` in the body, mismatch 409, +1 on change.
//  * API keys act with their creator's scope (D5): they may play (the log holds `apikey:<id>`, like task history: actorIdOf) and, when the creator may,
//    set or clear. `recordedBy` is the creator (subjectUserId): the person whose note it is, which is also what the DSR export/erase looks for.
//  * Device policy: only Drive links are device-restricted (D22). A voice note is audio the company asked for, not a link, so playing is the same on every device.
//  * History says "Voice note added / replaced / removed" and never a file name; notifications go to the assignees and the creator for added/replaced.
//
// LAST-REFERENCE DELETION AND THE RECURRENCE JOB. A recurring series and its instances share one file id. Replace / clear / purge each ask "does any
// other task still point at the old file?" (voiceFileStillReferenced) and expire the file when not. All three run under TASK_PURGE_LOCK_NS (taken before
// the actor lock and any task row), so two droppers never run their check-and-delete at the same time and the file cannot be orphaned (each would
// otherwise see the other's still-uncommitted reference). The recurrence job takes no purge lock, and does not need one: it copies the file id from the
// series row it holds FOR UPDATE.
//   - replace / clear ON THE SERIES holds that row FOR UPDATE too, so it is strictly before or after one materialise run. Before: the run copies the NEW
//     id (or none). After: the run's instance already holds the old id, which the reference check sees (the run committed first), so the old file is kept.
//   - replace / clear ON AN INSTANCE never touches the series row; the run may copy the series' id meanwhile, but the series itself still points at it,
//     so the check keeps the file; and if the series is dropping it at the same time, that drop is serialised with this one by the purge lock.
//   - purge only runs on archived series, which the job skips (archived_at is null in its locked read).
// Instances created before a replace keep the old note (they are snapshots; the old file lives until the last of them drops it).

export const VOICE_MAX_SEC = 120

const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const UID = "usr_8Kq2mZ4tW1"
export const VoicePutBody = z
  .object({
    version: Version,
    fileId: z.uuid().openapi({ description: "A `voice` upload of THIS task, already scanned clean", example: TID }),
    durationSec: z.number().int().min(1).openapi({ description: "The client's claim, 1 to 120 (the size cap is the server-side bound); more is 422 voice_too_long", example: 42 }),
  })
  .openapi({ example: { version: 3, fileId: TID, durationSec: 42 } })
export const VoiceDeleteBody = z.object({ version: Version }).openapi({ example: { version: 4 } })
export const PlaysQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25).openapi({ example: 25 }),
  cursor: z.string().max(500).optional().openapi({ example: "MjAyNi0xMS0yMFQxMDowMDowMC4wMDBafDZmMWMwZDUyLThkM2EtNGI3ZS05YzQxLTJhNWI3ZTkwZDNmOA" }),
})
const PlayItem = z.object({ id: z.uuid(), userId: z.string().nullable(), by: z.string(), at: z.string(), atUtc: z.string() })
export const PlaysList = z
  .object({ items: z.array(PlayItem), nextCursor: z.string().nullable() })
  .openapi({ example: { items: [{ id: TID, userId: UID, by: "Ann Byrne", at: "2026-11-20T10:00:00", atUtc: "2026-11-20T10:00:00.000Z" }], nextCursor: null } })

const NoVoice = () => NotFound("voice_note_not_found")
const FileNotFound = () => NotFound("file_not_found")

/**
 * PUT /v1/tasks/{id}/voice-note: the creator or a manager attaches a clean `voice` upload of this task (replacing any earlier note).
 * Order: purge lock → actor → task row FOR UPDATE → permission → duration → version → the file (FOR SHARE) → write → old file → history → notify → publish.
 */
export async function setVoiceNote(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: z.infer<typeof VoicePutBody>): Promise<TaskDto> {
  const { row, manage } = await lockedTask(tx, ctx, id, { onArchived: "conflict" })
  if (!manage && row.creatorId !== ctx.me) throw Forbidden("forbidden")
  if (input.durationSec > VOICE_MAX_SEC) throw unprocessable("voice_too_long")
  staleVersion(row, input.version)
  // A voice upload of THIS task: another task's, another tenant's and an unknown id all look the same (404), as does an attachment or evidence file.
  const [f] = await tx
    .select({ id: files.id, status: files.status, mime: files.mime, sizeBytes: files.sizeBytes })
    .from(taskFiles)
    .innerJoin(files, and(eq(files.tenantId, taskFiles.tenantId), eq(files.id, taskFiles.fileId)))
    .where(and(eq(taskFiles.tenantId, ctx.tenantId), eq(taskFiles.taskId, row.id), eq(taskFiles.fileId, input.fileId), eq(taskFiles.purpose, "task_voice")))
    .for("share", { of: [files] }) // an expiry of the file (FOR UPDATE) waits for this tx
  if (!f || f.status === "deleted") throw FileNotFound()
  if (f.status === "infected") throw new AppError(410, "file_infected", "Gone")
  if (f.status !== "clean") throw Conflict("file_not_ready")
  if (!(TASK_VOICE_MIMES as readonly string[]).includes(f.mime)) throw unprocessable("mime_not_allowed")
  if (f.sizeBytes > env.deps.env.TASK_VOICE_MAX_BYTES) throw unprocessable("file_too_large")

  const old = row.voiceFileId
  const [next] = await tx
    .update(tasks)
    .set({
      voiceFileId: f.id, voiceMeta: { durationSec: input.durationSec, mime: f.mime, recordedBy: ctx.me, recordedAt: ctx.now.toISOString() },
      version: row.version + 1, updatedAt: ctx.now,
    })
    .where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId)))
    .returning()
  if (old && old !== f.id) await dropVoiceFile(tx, env, ctx, old, row.id)
  const recipients = changeRecipients(ctx, row, allAssignees((await assigneesOf(tx, ctx.tenantId, [row.id])).get(row.id)!))
  const historyId = await writeHistory(tx, ctx, row.id, { kind: "voice", text: old ? "Voice note replaced" : "Voice note added", notified: recipients })
  await notifyTask(tx, env, ctx, next, recipients, "Voice instructions")
  const dto = await taskDetailDto(tx, ctx, next)
  await publishTaskEvent(tx, ctx, { type: "task.updated", payload: { taskId: row.id, historyId, fields: ["voiceNote"] } })
  return dto
}

/** DELETE /v1/tasks/{id}/voice-note: the creator or a manager clears it (404 voice_note_not_found when there is none). Same lock order as setVoiceNote. */
export async function clearVoiceNote(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: z.infer<typeof VoiceDeleteBody>): Promise<TaskDto> {
  const { row, manage } = await lockedTask(tx, ctx, id, { onArchived: "conflict" })
  if (!manage && row.creatorId !== ctx.me) throw Forbidden("forbidden")
  if (!row.voiceFileId) throw NoVoice()
  staleVersion(row, input.version)
  const [next] = await tx
    .update(tasks)
    .set({ voiceFileId: null, voiceMeta: null, version: row.version + 1, updatedAt: ctx.now })
    .where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId)))
    .returning()
  await dropVoiceFile(tx, env, ctx, row.voiceFileId, row.id)
  const historyId = await writeHistory(tx, ctx, row.id, { kind: "voice", text: "Voice note removed" })
  const dto = await taskDetailDto(tx, ctx, next)
  await publishTaskEvent(tx, ctx, { type: "task.updated", payload: { taskId: row.id, historyId, fields: ["voiceNote"] } })
  return dto
}

/** The task gave up `fileId`: delete it (soft delete now, object removal after commit) unless another task still points at it. Needs the purge lock. */
async function dropVoiceFile(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, fileId: string, taskId: string): Promise<void> {
  if (await voiceFileStillReferenced(tx, ctx.tenantId, fileId, taskId)) return
  await expireFile(tx, ctx.tenantId, fileId, env.enqueue)
}

/** Runs a voice change as a mutation: the purge lock FIRST (advisory), then the actor lock (R25), then `fn` takes the task row. */
export function mutateVoice<T>(c: Context<AppEnv>, fn: (tx: TenantTx, env: TaskEnv, ctx: TaskCtx) => Promise<T>): Promise<T> {
  const deps = c.get("deps")
  const tenantId = c.get("tenant")!.id
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockTaskPurge(tx, tenantId)
    return fn(tx, { deps, enqueue }, await loadTaskCtx(c, tx, "write"))
  })
}

/**
 * GET /v1/tasks/{id}/voice-note: the 60 s presigned GET of the note for anyone who can see the task. The task row is read FOR SHARE (a purge cannot slip
 * between the check and the log insert), the scan gate is D10 (410 infected, 409 pending), the play is logged and the URL signed in the SAME tx: if either
 * step fails nothing is returned and nothing is logged; there is no way to a URL without its row. The file name is never put in the URL.
 */
export async function playVoiceNote(c: Context<AppEnv>, id: string): Promise<string> {
  const deps = c.get("deps")
  const tenantId = c.get("tenant")!.id
  return withTenant(deps.db, tenantId, async (tx) => {
    const ctx = await loadTaskCtx(c, tx)
    const row = await getTask(tx, ctx, id, { forShare: true })
    if (!row.voiceFileId) throw NoVoice()
    const [f] = await tx.select({ key: files.key, mime: files.mime, status: files.status }).from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, row.voiceFileId)))
    if (!f || f.status === "deleted") throw NoVoice()
    if (f.status === "infected") throw new AppError(410, "file_infected", "Gone")
    if (f.status !== "clean") throw Conflict("file_not_ready")
    await tx.insert(taskVoiceAccess).values({ tenantId, taskId: row.id, fileId: row.voiceFileId, userId: actorIdOf(c), at: deps.clock.now() })
    return deps.storage.presignGet(f.key, { name: "voice-note", mime: f.mime, expiresSec: DOWNLOAD_TTL_SEC })
  })
}

/** Plays of one task, newest first, keyset on (at, id): task_voice_access_task_idx scanned backwards. Exported for the EXPLAIN test. */
export const playsQuery = (tx: TenantTx, ctx: Pick<TaskCtx, "tenantId">, taskId: string, after: { at: Date; id: string } | null, take: number) =>
  tx
    .select()
    .from(taskVoiceAccess)
    .where(and(eq(taskVoiceAccess.tenantId, ctx.tenantId), eq(taskVoiceAccess.taskId, taskId), after ? or(lt(taskVoiceAccess.at, after.at), and(eq(taskVoiceAccess.at, after.at), lt(taskVoiceAccess.id, after.id))) : undefined))
    .orderBy(desc(taskVoiceAccess.at), desc(taskVoiceAccess.id))
    .limit(take)

/** GET /v1/tasks/{id}/voice-note/plays: who played the note. Managers of the task only (403 for anyone else who sees it; 404 when out of scope). */
export async function listPlays(tx: TenantTx, ctx: TaskCtx, id: string, o: { limit: number; cursor?: string }): Promise<z.infer<typeof PlaysList>> {
  const row = await getTask(tx, ctx, id)
  if (!canManage(ctx, row, allAssignees((await assigneesOf(tx, ctx.tenantId, [row.id])).get(row.id)!))) throw Forbidden("forbidden")
  const after = o.cursor ? decodeCursor(o.cursor) : null
  const rows = await playsQuery(tx, ctx, row.id, after, o.limit + 1)
  const page = rows.slice(0, o.limit)
  const nameOf = await namesOf(tx, page.flatMap((p) => (p.userId ? [p.userId] : [])))
  const last = page[page.length - 1]
  return {
    items: page.map((p) => ({ id: p.id, userId: p.userId, by: p.userId ? nameOf(p.userId) : "Former member", at: wallOf(p.at, ctx.tz), atUtc: p.at.toISOString() })),
    nextCursor: rows.length > o.limit && last ? encodeCursor(last.at, last.id) : null,
  }
}
