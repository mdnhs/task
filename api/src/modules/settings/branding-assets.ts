import { and, eq, lt, ne } from "drizzle-orm"
import { AppError, Conflict, NotFound } from "../../core/errors"
import { files } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { expireFile, type UploadPolicy } from "../files"
import { withTenantAfterCommit } from "../notifications"
import { lockActor } from "../rbac"
import { FAVICON_MAX_BYTES, FAVICON_MIMES, ImageRejected, inspectBrandingImage, LOGO_MAX_BYTES, LOGO_MIMES, type BrandingKind } from "./image-inspect"
import { lockSettings, readSetting, writeSetting } from "./service"

/**
 * The organization logo and favicon. Both are ordinary tenant files in the B2 pipeline (presigned PUT to staging, ETag-pinned copy, ClamAV scan, `files`
 * row) under a scoped purpose (`branding_logo`, `branding_favicon`), so /v1/files never lists, downloads or deletes them. The tenant setting `branding`
 * holds which file is live per kind with its public facts (version = first 16 hex of the scanned SHA-256, mime, pixel size, bytes). The bytes are served by
 * GET /v1/branding/{kind} only, to members of the tenant, never through a presigned URL.
 */
export type BrandingAssetDto = { version: string; mime: string; width: number; height: number; sizeBytes: number }
export type StoredAsset = BrandingAssetDto & { fileId: string }

export const purposeOf = (kind: BrandingKind) => (kind === "logo" ? "branding_logo" : "branding_favicon") as "branding_logo" | "branding_favicon"
/** Uploads that were started but never made live are removed once they are this old, whenever the same kind is activated or removed. */
const STALE_AFTER_MS = 60 * 60 * 1000

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const NotFoundFile = () => NotFound("file_not_found")

/** The kind-specific part of the upload: the allow-list, the size cap and, on `complete`, the content check of the real bytes. */
export function brandingPolicy(kind: BrandingKind, tenantId: string, actorId: string): UploadPolicy {
  return {
    purpose: purposeOf(kind),
    mimes: kind === "logo" ? LOGO_MIMES : FAVICON_MIMES,
    maxBytes: () => (kind === "logo" ? LOGO_MAX_BYTES : FAVICON_MAX_BYTES),
    lock: async (tx) => {
      await lockSettings(tx, tenantId)
      await lockActor(tx, tenantId, actorId, "settings", "write")
    },
    inspect: (bytes, mime) => inspectOrRefuse(kind, mime, bytes),
  }
}

function inspectOrRefuse(kind: BrandingKind, mime: string, bytes: Buffer) {
  try {
    return inspectBrandingImage(kind, mime, bytes)
  } catch (e) {
    if (e instanceof ImageRejected) throw unprocessable(e.code)
    throw e
  }
}

const toDto = (a: StoredAsset | null | undefined): BrandingAssetDto | null => (a ? { version: a.version, mime: a.mime, width: a.width, height: a.height, sizeBytes: a.sizeBytes } : null)

/** The stored asset of a kind in a `branding` setting value, tolerating any older or malformed shape (a bad value reads as none). */
export function assetOf(v: unknown, kind: BrandingKind): StoredAsset | null {
  const a = (v as Record<string, unknown> | undefined)?.[kind] as Partial<StoredAsset> | null | undefined
  if (!a || typeof a !== "object") return null
  return typeof a.fileId === "string" && typeof a.version === "string" && typeof a.mime === "string" && Number.isInteger(a.width) && Number.isInteger(a.height) && Number.isInteger(a.sizeBytes) ? (a as StoredAsset) : null
}
export const publicAsset = (v: unknown, kind: BrandingKind): BrandingAssetDto | null => toDto(assetOf(v, kind))

async function readRaw(tx: TenantTx, tenantId: string): Promise<Record<string, unknown>> {
  const v = await readSetting(tx, tenantId, "branding")
  return v && typeof v === "object" ? { ...(v as Record<string, unknown>) } : {}
}

/** Live file row of this tenant and purpose (404 file_not_found for anything else, so another tenant's or another kind's id looks missing). */
async function brandingFile(tx: TenantTx, tenantId: string, kind: BrandingKind, id: string, lock = false) {
  const q = tx.select().from(files).where(and(eq(files.id, id), eq(files.tenantId, tenantId)))
  const [row] = lock ? await q.for("update") : await q
  if (!row || row.status === "deleted" || row.purpose !== purposeOf(kind)) throw NotFoundFile()
  return row
}

/** Scan state of an upload the caller made (the web polls this until it is clean or blocked). */
export async function uploadStatus(deps: Deps, tenantId: string, actorId: string, kind: BrandingKind, id: string): Promise<{ fileId: string; status: "pending" | "clean" | "infected" }> {
  return withTenant(deps.db, tenantId, async (tx) => {
    await lockActor(tx, tenantId, actorId, "settings", "write")
    const row = await brandingFile(tx, tenantId, kind, id)
    return { fileId: row.id, status: row.status === "clean" ? "clean" : row.status === "infected" ? "infected" : "pending" }
  })
}

/** Reads an object fully (a branding image is at most 1 MB). */
async function readAll(deps: Deps, key: string): Promise<Buffer> {
  const stream = await deps.storage.getStream(key)
  const chunks: Buffer[] = []
  try {
    for await (const c of stream) chunks.push(c as Buffer)
  } finally {
    stream.destroy()
  }
  return Buffer.concat(chunks)
}

/** Expires the other uploads of this kind that were never made live and are older than STALE_AFTER_MS (the existing delete-object lifecycle removes their objects). */
async function expireStale(deps: Deps, tx: TenantTx, tenantId: string, kind: BrandingKind, keepId: string | null, enqueue: Parameters<typeof expireFile>[3]): Promise<void> {
  const cutoff = new Date(deps.clock.now().getTime() - STALE_AFTER_MS)
  const rows = await tx.select({ id: files.id }).from(files).where(and(eq(files.tenantId, tenantId), eq(files.purpose, purposeOf(kind)), ne(files.status, "deleted"), lt(files.createdAt, cutoff), keepId ? ne(files.id, keepId) : undefined))
  for (const r of rows) await expireFile(tx, tenantId, r.id, enqueue)
}

/** Makes a CLEAN upload the live logo or favicon: re-checks the bytes of the scanned object, replaces the previous one (its file is expired), audits (never the contents). */
export async function activateAsset(deps: Deps, tenantId: string, actorId: string, kind: BrandingKind, fileId: string): Promise<void> {
  await withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockSettings(tx, tenantId)
    await lockActor(tx, tenantId, actorId, "settings", "write")
    const row = await brandingFile(tx, tenantId, kind, fileId, true)
    if (row.status === "infected") throw new AppError(410, "file_infected", "Gone")
    if (row.status !== "clean" || !row.sha256 || !row.etag) throw Conflict("file_not_ready")
    const raw = await readRaw(tx, tenantId)
    const before = assetOf(raw, kind)
    if (before?.fileId === fileId) return // already live
    const head = await deps.storage.head(row.key)
    if (!head || head.etag !== row.etag) throw Conflict("upload_changed") // the object is not the one that was scanned
    const info = inspectOrRefuse(kind, row.mime, await readAll(deps, row.key)) // the scanned bytes, once more, before they go live
    const after: StoredAsset = { fileId, version: row.sha256.slice(0, 16), mime: info.mime, width: info.width, height: info.height, sizeBytes: row.sizeBytes }
    await writeSetting(tx, tenantId, "branding", { ...raw, [kind]: after })
    if (before) await expireFile(tx, tenantId, before.fileId, enqueue)
    await expireStale(deps, tx, tenantId, kind, fileId, enqueue)
    await recordAudit(tx, tenantId, { action: `tenant.branding_${kind}_updated`, entity: "tenant", entityId: tenantId, actorId, before: { [kind]: toDto(before) }, after: { [kind]: toDto(after) } }, deps.clock.now())
  })
}

/** Removes the live logo or favicon (its file is expired). Idempotent: with none set nothing changes and nothing is audited. */
export async function removeAsset(deps: Deps, tenantId: string, actorId: string, kind: BrandingKind): Promise<void> {
  await withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockSettings(tx, tenantId)
    await lockActor(tx, tenantId, actorId, "settings", "write")
    const raw = await readRaw(tx, tenantId)
    const before = assetOf(raw, kind)
    await expireStale(deps, tx, tenantId, kind, null, enqueue)
    if (!before) return
    await writeSetting(tx, tenantId, "branding", { ...raw, [kind]: null })
    await expireFile(tx, tenantId, before.fileId, enqueue)
    await recordAudit(tx, tenantId, { action: `tenant.branding_${kind}_removed`, entity: "tenant", entityId: tenantId, actorId, before: { [kind]: toDto(before) }, after: { [kind]: null } }, deps.clock.now())
  })
}

export const fileNameOf = (kind: BrandingKind, mime: string): string => `${kind}.${mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : mime === "image/x-icon" ? "ico" : "png"}`

/** What GET /v1/branding/{kind} sends: null when none is live (or its file is no longer clean). `open` re-checks the stored ETag against the scanned one (fail closed). */
export async function servedAsset(deps: Deps, tenantId: string, kind: BrandingKind): Promise<{ version: string; mime: string; sizeBytes: number; name: string; etag: string; key: string } | null> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const a = assetOf(await readSetting(tx, tenantId, "branding"), kind)
    if (!a) return null
    const [row] = await tx.select().from(files).where(and(eq(files.id, a.fileId), eq(files.tenantId, tenantId)))
    if (!row || row.status !== "clean" || row.purpose !== purposeOf(kind) || !row.etag) return null
    return { version: a.version, mime: a.mime, sizeBytes: row.sizeBytes, name: fileNameOf(kind, a.mime), etag: row.etag, key: row.key }
  })
}
