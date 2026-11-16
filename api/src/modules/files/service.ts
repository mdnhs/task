import { createHash } from "node:crypto"
import { PassThrough, type Readable } from "node:stream"
import { and, eq } from "drizzle-orm"
import { can } from "@opsdesk/domain/permissions"
import type { ResolvedRole } from "../../core/context"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { fileKey, ObjectMissingError, PreconditionFailedError, stagingKey, type PresignedPut } from "../../core/storage/storage"
import { files, type FileStatus } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { publish } from "../../core/events"
import { recordAudit } from "../audit"
import { notify, withTenantAfterCommit } from "../notifications"
import { lockActor } from "../rbac"
import { canonicalName, normalizeMime } from "./mime"

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
/** A caller that may read: the role decides files:read, and who may open a DSR export. */
export type FileReader = { userId: string; role: ResolvedRole }
type Row = typeof files.$inferSelect
export type FileDto = {
  id: string
  name: string
  mime: string
  sizeBytes: number
  status: FileStatus
  signature: string | null
  sha256: string | null
  /** null once the owner was erased (GDPR) or for a generated file. */
  ownerUserId: string | null
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

/**
 * Files with `purpose = 'dsr_export'` hold one person's personal data: only the requester (owner) and settings:write
 * users may open them, whatever their files access. Anyone else gets the same 404 as for a missing file.
 */
const dsrAllowed = (row: Row, who: FileReader): boolean => row.purpose !== "dsr_export" || row.ownerUserId === who.userId || can(who.role, "settings", "write")

/**
 * The live file for a read. Ordinary files need files:read (403 first, as the route guard used to do, so a caller
 * without access never learns whether an id exists); a DSR export is readable by its requester and settings:write
 * without files access. Anything else about a DSR export is 404 file_not_found.
 */
async function readableFile(tx: TenantTx, tenantId: string, id: string, who: FileReader): Promise<Row> {
  const canRead = can(who.role, "files", "read")
  const [row] = await tx.select().from(files).where(and(eq(files.id, id), eq(files.tenantId, tenantId)))
  if (!row) throw canRead ? NotFoundFile() : Forbidden("forbidden")
  if (row.purpose === "dsr_export") {
    if (!dsrAllowed(row, who)) throw NotFoundFile()
  } else if (!canRead) throw Forbidden("forbidden")
  if (row.status === "deleted") throw NotFoundFile()
  return row
}

/** A live (not soft-deleted) file of this tenant, or 404. RLS plus an explicit tenant filter. */
async function liveFile(tx: TenantTx, tenantId: string, id: string, lock = false): Promise<Row> {
  const q = tx.select().from(files).where(and(eq(files.id, id), eq(files.tenantId, tenantId)))
  const [row] = lock ? await q.for("update") : await q
  if (!row || row.status === "deleted") throw NotFoundFile()
  return row
}

// ---------------------------------------------------------------- requests

export async function createUpload(deps: Deps, tenantId: string, actor: Actor, input: { name: string; mime: string; sizeBytes: number }): Promise<{ fileId: string; upload: PresignedPut }> {
  const mime = normalizeMime(input.mime)
  if (!mime) throw new AppError(422, "mime_not_allowed", "Unprocessable Entity")
  if (!(input.name as unknown as { isWellFormed(): boolean }).isWellFormed()) throw new AppError(422, "invalid_name", "Unprocessable Entity")
  const name = canonicalName(input.name, mime)
  const max = deps.env.FILE_MAX_BYTES
  if (input.sizeBytes > max) throw new AppError(422, "file_too_large", "Unprocessable Entity")
  const id = crypto.randomUUID()
  const key = fileKey(tenantId, id) // final key: server-generated ids only, never in any upload URL
  // presign first: with storage unconfigured (503) nothing is inserted
  const upload = await deps.storage.presignPut(stagingKey(tenantId, id), { mime, sizeBytes: input.sizeBytes, expiresSec: UPLOAD_TTL_SEC })
  await withTenant(deps.db, tenantId, async (tx) => {
    await lockActor(tx, tenantId, actor.userId, "files", "write")
    await tx.insert(files).values({ id, tenantId, ownerUserId: actor.userId, key, name, mime, sizeBytes: input.sizeBytes, status: "pending", createdAt: deps.clock.now() })
  })
  return { fileId: id, upload }
}

/**
 * Confirms the browser's upload. Uploads land on the STAGING key (`u/<tenant>/<id>`, the only key a presigned PUT
 * names). Everything happens inside ONE tx under the file row's `FOR UPDATE` lock, so the final key is written at most
 * once: HEAD staging (size == declared, <= FILE_MAX_BYTES, type == declared, else the staging object is deleted and 422
 * upload_mismatch; missing -> 409 upload_missing), server-side CopyObject to `t/<tenant>/<id>` pinned to the ETag just
 * read (a swap gives 409 upload_changed), then `uploaded_at` is set and `file.uploaded` published. A concurrent
 * `complete` blocks on the row lock, then sees `uploaded_at` set and returns the idempotent result WITHOUT copying; a
 * later re-PUT to the old URL only touches staging. (Holding the row lock for one HEAD + one CopyObject is accepted.)
 * After commit: `file.scan` (final object) and `file.delete-object {staging:true}` jobs. Status stays `pending` until
 * the scan. A repeat call on a still-pending file only queues another scan job. If a crash left the copy done but
 * `uploaded_at` unset, the next call re-copies from staging (nothing was scanned yet) or, when staging is gone, verifies
 * and adopts the existing final object.
 */
export async function completeUpload(deps: Deps, tenantId: string, actor: Actor, id: string): Promise<FileDto> {
  const staging = stagingKey(tenantId, id)
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockActor(tx, tenantId, actor.userId, "files", "write")
    const row = await liveFile(tx, tenantId, id, true)
    if (row.status !== "pending") return dto(row) // already scanned: nothing to do
    let cur = row
    if (!row.uploadedAt) {
      const head = await deps.storage.head(staging)
      const src = head ?? (await deps.storage.head(row.key)) // recovery: copied earlier, tx never committed
      if (!src) throw Conflict("upload_missing")
      if (src.size !== row.sizeBytes || src.size > deps.env.FILE_MAX_BYTES || src.contentType !== row.mime) {
        if (head) await deps.storage.delete(staging) // a wrong object is never kept; the client must start a new upload
        throw new AppError(422, "upload_mismatch", "Unprocessable Entity")
      }
      if (head) {
        try {
          await deps.storage.copy(staging, row.key, { ifMatchEtag: head.etag })
        } catch (e) {
          if (e instanceof PreconditionFailedError) throw Conflict("upload_changed")
          if (e instanceof ObjectMissingError) throw Conflict("upload_missing")
          throw e
        }
      }
      const now = deps.clock.now()
      ;[cur] = await tx.update(files).set({ uploadedAt: now }).where(and(eq(files.id, id), eq(files.tenantId, tenantId))).returning()
      await publish(tx, { tenantId, type: "file.uploaded", payload: { fileId: id, mime: row.mime, sizeBytes: row.sizeBytes }, actorId: actor.userId }, now)
      enqueue(DELETE_OBJECT_JOB, { fileId: id, tenantId, staging: true }, { key: `${id}-${crypto.randomUUID()}` })
    }
    enqueue(SCAN_JOB, { fileId: id, tenantId }, { key: `${id}-${crypto.randomUUID()}` })
    return dto(cur)
  })
}

export async function getFile(tx: TenantTx, tenantId: string, id: string, who: FileReader): Promise<FileDto> {
  return dto(await readableFile(tx, tenantId, id, who))
}

/**
 * The 60 s download URL, only for a `clean` file. It always names the FINAL key, which only the server writes (copy at
 * `complete`), so the bytes behind it are exactly the ones that were scanned.
 */
export async function downloadUrl(deps: Deps, tenantId: string, id: string, who: FileReader): Promise<string> {
  const row = await withTenant(deps.db, tenantId, (tx) => readableFile(tx, tenantId, id, who))
  if (row.status === "infected") throw new AppError(410, "file_infected", "Gone")
  if (row.status !== "clean") throw Conflict("file_not_ready")
  return deps.storage.presignGet(row.key, { name: row.name, mime: row.mime, expiresSec: DOWNLOAD_TTL_SEC })
}

export async function deleteFile(deps: Deps, tenantId: string, actor: Actor, id: string): Promise<void> {
  await withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    const role = await lockActor(tx, tenantId, actor.userId, "files", "write")
    const row = await liveFile(tx, tenantId, id, true)
    if (!dsrAllowed(row, { userId: actor.userId, role })) throw NotFoundFile()
    const now = deps.clock.now()
    await tx.update(files).set({ status: "deleted" }).where(and(eq(files.id, id), eq(files.tenantId, tenantId)))
    await recordAudit(tx, tenantId, { action: "file.deleted", entity: "file", entityId: id, actorId: actor.userId, before: { status: row.status, name: row.name, mime: row.mime, sizeBytes: row.sizeBytes }, after: { status: "deleted" } }, now)
    enqueue(DELETE_OBJECT_JOB, { fileId: id, tenantId }, { key: `${id}-${crypto.randomUUID()}` })
    await publish(tx, { tenantId, type: "file.deleted", payload: { fileId: id }, actorId: actor.userId }, now)
  })
}

/**
 * A file the SERVER generated (a DSR export): written straight to the final key `t/<tenant>/<id>` and recorded as
 * `clean` with no scan, because we produced the bytes ourselves (never a client upload). Deterministic ids make a
 * re-run overwrite the same key and keep the same row (ON CONFLICT DO NOTHING), so there are no orphans.
 */
export async function storeGeneratedFile(
  deps: Deps, tx: TenantTx,
  f: { tenantId: string; id: string; ownerUserId: string | null; name: string; mime: string; body: Buffer; purpose: "dsr_export" },
): Promise<void> {
  const key = fileKey(f.tenantId, f.id)
  await deps.storage.put(key, f.body, { contentType: f.mime })
  const head = await deps.storage.head(key)
  if (!head || head.size !== f.body.length) throw new Error("generated object missing after put")
  const now = deps.clock.now()
  await tx
    .insert(files)
    .values({
      id: f.id, tenantId: f.tenantId, ownerUserId: f.ownerUserId, key, name: f.name, mime: f.mime, sizeBytes: f.body.length, purpose: f.purpose,
      sha256: createHash("sha256").update(f.body).digest("hex"), status: "clean", etag: head.etag, createdAt: now, uploadedAt: now, scannedAt: now,
    })
    .onConflictDoNothing({ target: files.id })
}

/** Soft-deletes a live file and queues removal of its object (same path as deleteFile, for system actors). */
export async function expireFile(tx: TenantTx, tenantId: string, id: string, enqueue: (name: string, data: unknown, o?: { key?: string }) => void): Promise<boolean> {
  const [row] = await tx.select({ status: files.status }).from(files).where(and(eq(files.id, id), eq(files.tenantId, tenantId))).for("update")
  if (!row || row.status === "deleted") return false
  await tx.update(files).set({ status: "deleted" }).where(and(eq(files.id, id), eq(files.tenantId, tenantId)))
  enqueue(DELETE_OBJECT_JOB, { fileId: id, tenantId }, { key: `${id}-${crypto.randomUUID()}` })
  return true
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
      await deps.queue.add(SCAN_JOB, { fileId: row.id, tenantId: row.tenantId, attempt: next }, { delayMs: scanBackoffMs(job.attempt), jobId: `${SCAN_JOB}.${row.id}-${next}-${crypto.randomUUID()}` })
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
    if (row.ownerUserId) await notify(tx, row.tenantId, { userId: row.ownerUserId, kind: "file", title: "File blocked", body: `"${row.name}" was blocked because malware was detected. It has been removed.` }, deps, enqueue)
    enqueue(DELETE_OBJECT_JOB, { fileId: row.id, tenantId: row.tenantId }, { key: `${row.id}-${crypto.randomUUID()}` })
    await publish(tx, { tenantId: row.tenantId, type: "file.scanned", payload: { fileId: row.id, status: "infected", signature: result.signature }, actorId: null }, now)
  })
}

/**
 * Job `file.delete-object` { fileId, tenantId, staging? }. `staging: true` removes only the upload (staging) object,
 * which is never served, so it is always safe. Otherwise it removes the final object (and any staging leftover), but
 * ONLY for a row that is `infected` or `deleted`; a pending or clean file's final object is never touched here.
 */
export async function deleteObject(data: unknown, deps: Deps): Promise<void> {
  const job = parseJob(data, DELETE_OBJECT_JOB)
  const staging = (data as { staging?: unknown }).staging === true
  const row = await withTenant(deps.db, job.tenantId, async (tx) => {
    const [r] = await tx.select({ key: files.key, status: files.status }).from(files).where(and(eq(files.id, job.fileId), eq(files.tenantId, job.tenantId)))
    return r
  })
  if (!row) return
  if (staging) return deps.storage.delete(stagingKey(job.tenantId, job.fileId))
  if (row.status !== "infected" && row.status !== "deleted") return
  await deps.storage.delete(row.key)
  await deps.storage.delete(stagingKey(job.tenantId, job.fileId))
}
