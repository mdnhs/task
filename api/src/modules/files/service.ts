import { createHash } from "node:crypto"
import { PassThrough, type Readable } from "node:stream"
import { and, eq } from "drizzle-orm"
import { AppError, Conflict, NotFound } from "../../core/errors"
import { fileKey, type PresignedPost } from "../../core/storage/storage"
import { files, type FileStatus } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { publish } from "../../core/events"
import { recordAudit } from "../audit"
import { notify, withTenantAfterCommit } from "../notifications"
import { lockActor } from "../rbac"
import { normalizeMime } from "./mime"

export const SCAN_JOB = "file.scan"
export const DELETE_OBJECT_JOB = "file.delete-object"
/** Presigned POST validity (FR-M0-12: short-lived, never above 300 s). */
export const UPLOAD_TTL_SEC = 300
/** Presigned GET validity. */
export const DOWNLOAD_TTL_SEC = 60
/** Scan attempts (own backoff scheduling, like notification.send) before the file is left pending and an error is logged. */
export const MAX_SCAN_ATTEMPTS = 5
export const scanBackoffMs = (attempt: number): number => 30_000 * 2 ** (attempt - 1)

type Actor = { userId: string }
type Row = typeof files.$inferSelect
export type FileDto = {
  id: string
  name: string
  mime: string
  sizeBytes: number
  status: FileStatus
  signature: string | null
  sha256: string | null
  ownerUserId: string
  createdAt: string
  scannedAt: string | null
}

const dto = (r: Row): FileDto => ({
  id: r.id, name: r.name, mime: r.mime, sizeBytes: r.sizeBytes, status: r.status as FileStatus, signature: r.signature, sha256: r.sha256,
  ownerUserId: r.ownerUserId, createdAt: r.createdAt.toISOString(), scannedAt: r.scannedAt?.toISOString() ?? null,
})

const NotFoundFile = () => NotFound("file_not_found")
const safeCode = (e: unknown): string => {
  const c = e && typeof e === "object" ? ((e as { code?: unknown }).code ?? (e as { name?: unknown }).name) : undefined
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : "error"
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A live (not soft-deleted) file of this tenant, or 404. RLS plus an explicit tenant filter. */
async function liveFile(tx: TenantTx, tenantId: string, id: string, lock = false): Promise<Row> {
  const q = tx.select().from(files).where(and(eq(files.id, id), eq(files.tenantId, tenantId)))
  const [row] = lock ? await q.for("update") : await q
  if (!row || row.status === "deleted") throw NotFoundFile()
  return row
}

// ---------------------------------------------------------------- requests

export async function createUpload(deps: Deps, tenantId: string, actor: Actor, input: { name: string; mime: string; sizeBytes: number }): Promise<{ fileId: string; upload: PresignedPost }> {
  const mime = normalizeMime(input.mime)
  if (!mime) throw new AppError(422, "mime_not_allowed", "Unprocessable Entity")
  const max = deps.env.FILE_MAX_BYTES
  if (input.sizeBytes > max) throw new AppError(422, "file_too_large", "Unprocessable Entity")
  const id = crypto.randomUUID()
  const key = fileKey(tenantId, id) // server-generated ids only; the client name is metadata, never part of the key
  await withTenant(deps.db, tenantId, async (tx) => {
    await lockActor(tx, tenantId, actor.userId, "files", "write")
    await tx.insert(files).values({ id, tenantId, ownerUserId: actor.userId, key, name: input.name, mime, sizeBytes: input.sizeBytes, status: "pending", createdAt: deps.clock.now() })
  })
  const upload = await deps.storage.presignPost(key, { mime, maxBytes: Math.min(input.sizeBytes, max), expiresSec: UPLOAD_TTL_SEC })
  return { fileId: id, upload }
}

/**
 * Confirms the browser's upload: the stored object must have the intent's size and content type (422 upload_mismatch),
 * and exist (409 upload_missing). Status stays `pending`; a `file.scan` job is queued after commit. Idempotent: a
 * second call changes nothing (the job id dedupes the scan; `file.uploaded` is published only the first time).
 */
export async function completeUpload(deps: Deps, tenantId: string, actor: Actor, id: string): Promise<FileDto> {
  const pre = await withTenant(deps.db, tenantId, (tx) => liveFile(tx, tenantId, id))
  // the storage round trip happens outside any DB transaction
  const head = pre.uploadedAt || pre.status !== "pending" ? null : await deps.storage.head(pre.key)
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockActor(tx, tenantId, actor.userId, "files", "write")
    const row = await liveFile(tx, tenantId, id, true)
    if (row.status !== "pending") return dto(row) // already scanned: nothing to do
    let cur = row
    if (!row.uploadedAt) {
      if (!head) throw Conflict("upload_missing")
      if (head.size !== row.sizeBytes || head.contentType !== row.mime) throw new AppError(422, "upload_mismatch", "Unprocessable Entity")
      const now = deps.clock.now()
      ;[cur] = await tx.update(files).set({ uploadedAt: now, etag: head.etag }).where(and(eq(files.id, id), eq(files.tenantId, tenantId))).returning()
      await publish(tx, { tenantId, type: "file.uploaded", payload: { fileId: id, mime: row.mime, sizeBytes: row.sizeBytes }, actorId: actor.userId }, now)
    }
    enqueue(SCAN_JOB, { fileId: id, tenantId }, { key: id })
    return dto(cur)
  })
}

export async function getFile(tx: TenantTx, tenantId: string, id: string): Promise<FileDto> {
  return dto(await liveFile(tx, tenantId, id))
}

/**
 * The 60 s download URL, only for a `clean` file whose stored object is still the one that was scanned: the object's
 * ETag must equal the scanned one, otherwise (replaced through a still-valid upload POST) the file goes back to
 * `pending`, is rescanned, and the download is refused (409 file_not_ready).
 */
export async function downloadUrl(deps: Deps, tenantId: string, id: string): Promise<string> {
  const row = await withTenant(deps.db, tenantId, (tx) => liveFile(tx, tenantId, id))
  if (row.status === "infected") throw new AppError(410, "file_infected", "Gone")
  if (row.status !== "clean") throw Conflict("file_not_ready")
  const head = await deps.storage.head(row.key)
  if (!head || head.etag !== row.etag || head.size !== row.sizeBytes) {
    await withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
      const cur = await liveFile(tx, tenantId, id, true)
      if (cur.status !== "clean") return
      await tx.update(files).set({ status: "pending", sha256: null, etag: null, scannedAt: null }).where(and(eq(files.id, id), eq(files.tenantId, tenantId)))
      enqueue(SCAN_JOB, { fileId: id, tenantId, attempt: 1 }, { key: `${id}-rescan-${deps.clock.now().getTime()}` })
    })
    throw Conflict("file_not_ready")
  }
  return deps.storage.presignGet(row.key, { name: row.name, mime: row.mime, expiresSec: DOWNLOAD_TTL_SEC })
}

export async function deleteFile(deps: Deps, tenantId: string, actor: Actor, id: string): Promise<void> {
  await withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockActor(tx, tenantId, actor.userId, "files", "write")
    const row = await liveFile(tx, tenantId, id, true)
    const now = deps.clock.now()
    await tx.update(files).set({ status: "deleted" }).where(and(eq(files.id, id), eq(files.tenantId, tenantId)))
    await recordAudit(tx, tenantId, { action: "file.deleted", entity: "file", entityId: id, actorId: actor.userId, before: { status: row.status, name: row.name, mime: row.mime, sizeBytes: row.sizeBytes }, after: { status: "deleted" } }, now)
    enqueue(DELETE_OBJECT_JOB, { fileId: id, tenantId }, { key: id })
  })
}

// ---------------------------------------------------------------- jobs

type JobData = { fileId: string; tenantId: string; attempt: number }
function parseJob(data: unknown, name: string): JobData {
  const d = data as { fileId?: unknown; tenantId?: unknown; attempt?: unknown }
  if (typeof d?.fileId !== "string" || typeof d?.tenantId !== "string" || !UUID.test(d.fileId) || !UUID.test(d.tenantId)) throw new Error(`invalid ${name} job data`)
  const attempt = typeof d.attempt === "number" && Number.isInteger(d.attempt) && d.attempt >= 1 && d.attempt <= MAX_SCAN_ATTEMPTS ? d.attempt : 1
  return { fileId: d.fileId, tenantId: d.tenantId, attempt }
}

/**
 * Job `file.scan` { fileId, tenantId, attempt? }. Streams the object from storage through the scanner, hashing it on
 * the way (nothing is buffered beyond stream chunks), then in ONE tx (only if the file is still `pending`):
 *  - clean: status clean + sha256 + etag + scanned_at, `file.scanned` published, no audit;
 *  - infected: status infected + signature + sha256 + scanned_at, audit `file.infected` (same tx), owner notified
 *    (kind "file"), `file.scanned` published, object deleted by a `file.delete-object` job after commit.
 * Any failure (storage, scanner, object changed while scanning) fails closed: the file stays `pending` and the scan is
 * rescheduled with backoff up to MAX_SCAN_ATTEMPTS, then given up with an error log (ids only).
 */
export async function scanFile(data: unknown, deps: Deps): Promise<void> {
  const job = parseJob(data, SCAN_JOB)
  const row = await withTenant(deps.db, job.tenantId, async (tx) => {
    const [r] = await tx.select().from(files).where(and(eq(files.id, job.fileId), eq(files.tenantId, job.tenantId)))
    return r
  })
  if (!row || row.status !== "pending" || !row.uploadedAt) return // deleted, already decided, or not completed yet
  let source: Readable | undefined
  try {
    const before = await deps.storage.head(row.key)
    if (!before) throw new Error("object missing")
    if (before.size !== row.sizeBytes || before.contentType !== row.mime) throw new Error("object differs from the upload intent")
    const hash = createHash("sha256")
    const tap = new PassThrough()
    const src = (source = await deps.storage.getStream(row.key))
    src.on("data", (c: Buffer) => hash.update(c))
    src.on("error", (e) => tap.destroy(e))
    src.pipe(tap)
    const result = await deps.scanner.scan(tap)
    const after = await deps.storage.head(row.key)
    if (!after || after.etag !== before.etag) throw new Error("object changed while scanning")
    await recordVerdict(deps, row, result, hash.digest("hex"), before.etag)
  } catch (err) {
    source?.destroy() // never leave the storage connection open when the scanner stopped reading
    if (job.attempt < MAX_SCAN_ATTEMPTS) {
      const next = job.attempt + 1
      deps.logger.warn({ fileId: row.id, attempt: job.attempt, errCode: safeCode(err) }, "file scan failed, retrying")
      await deps.queue.add(SCAN_JOB, { fileId: row.id, tenantId: row.tenantId, attempt: next }, { delayMs: scanBackoffMs(job.attempt), jobId: `${SCAN_JOB}.${row.id}-${next}-${row.uploadedAt.getTime()}` })
    } else {
      deps.logger.error({ fileId: row.id, errCode: safeCode(err) }, "file scan gave up; the file stays pending")
    }
  }
}

async function recordVerdict(deps: Deps, row: Row, result: { clean: true } | { clean: false; signature: string }, sha256: string, etag: string): Promise<void> {
  await withTenantAfterCommit(deps, row.tenantId, async (tx, enqueue) => {
    const cur = await liveFile(tx, row.tenantId, row.id, true).catch((e: unknown) => {
      if (e instanceof AppError && e.status === 404) return null // deleted while scanning: the delete wins
      throw e
    })
    if (!cur || cur.status !== "pending") return
    const now = deps.clock.now()
    if (result.clean) {
      await tx.update(files).set({ status: "clean", sha256, etag, scannedAt: now }).where(and(eq(files.id, row.id), eq(files.tenantId, row.tenantId)))
      await publish(tx, { tenantId: row.tenantId, type: "file.scanned", payload: { fileId: row.id, status: "clean" }, actorId: null }, now)
      return
    }
    await tx.update(files).set({ status: "infected", signature: result.signature, sha256, scannedAt: now }).where(and(eq(files.id, row.id), eq(files.tenantId, row.tenantId)))
    await recordAudit(tx, row.tenantId, { action: "file.infected", entity: "file", entityId: row.id, actorId: null, before: { status: "pending" }, after: { status: "infected", signature: result.signature, sha256 } }, now)
    await notify(tx, row.tenantId, { userId: row.ownerUserId, kind: "file", title: "File blocked", body: `"${row.name}" was blocked because malware was detected. It has been removed.` }, deps, enqueue)
    enqueue(DELETE_OBJECT_JOB, { fileId: row.id, tenantId: row.tenantId }, { key: row.id })
    await publish(tx, { tenantId: row.tenantId, type: "file.scanned", payload: { fileId: row.id, status: "infected", signature: result.signature }, actorId: null }, now)
  })
}

/**
 * Job `file.delete-object` { fileId, tenantId }: removes the stored object, but ONLY for a row that is `infected` or
 * `deleted`; a pending or clean file's object is never touched by this job.
 */
export async function deleteObject(data: unknown, deps: Deps): Promise<void> {
  const job = parseJob(data, DELETE_OBJECT_JOB)
  const row = await withTenant(deps.db, job.tenantId, async (tx) => {
    const [r] = await tx.select({ key: files.key, status: files.status }).from(files).where(and(eq(files.id, job.fileId), eq(files.tenantId, job.tenantId)))
    return r
  })
  if (!row || (row.status !== "infected" && row.status !== "deleted")) return
  await deps.storage.delete(row.key)
}
