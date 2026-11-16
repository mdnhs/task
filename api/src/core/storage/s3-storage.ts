import { Readable } from "node:stream"
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { AppError } from "../errors"
import { ObjectMissingError, PreconditionFailedError, type Storage } from "./storage"

export type S3Config = { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }
/** Where the adapter gets its configuration; null = storage is not configured (every call answers 503). */
export type StorageConfigSource = { get(): Promise<S3Config | null> }

const TTL_MS = 60_000

/** RFC 5987 `ext-value` encoding for Content-Disposition filename*: percent-encode everything but attr-chars. */
export function rfc5987(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

const isMissing = (e: unknown): boolean => e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 404 || e.name === "NotFound" || e.name === "NoSuchKey")
export const StorageNotConfigured = () => new AppError(503, "storage_not_configured", "Service Unavailable")

/**
 * S3-compatible adapter (Cloudflare R2 in production, MinIO in tests). Uses only presigned PUT/GET plus server-side
 * HeadObject, GetObject, CopyObject and DeleteObject (all supported by R2). Configuration is read through `source`
 * and cached for at most 60 s (or until invalidate()).
 */
export function makeS3Storage(source: StorageConfigSource, o: { now?: () => number } = {}): Storage & { invalidate(): void; close(): void } {
  const now = o.now ?? Date.now
  let cached: { at: number; cfg: S3Config; client: S3Client } | { at: number; cfg: null } | null = null

  async function current(): Promise<{ cfg: S3Config; client: S3Client }> {
    if (!cached || now() - cached.at >= TTL_MS) {
      const cfg = await source.get()
      const prev = cached
      if (!cfg) cached = { at: now(), cfg: null }
      else if (prev?.cfg && sameConfig(prev.cfg, cfg)) cached = { at: now(), cfg, client: (prev as { client: S3Client }).client }
      else {
        cached = {
          at: now(), cfg,
          client: new S3Client({
            region: cfg.region, endpoint: cfg.endpoint, forcePathStyle: cfg.forcePathStyle,
            credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
            // no flexible-checksum query params on presigned URLs (R2 and plain browsers cannot send them)
            requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
          }),
        }
      }
      if (prev && "client" in prev && (!("client" in cached) || cached.client !== prev.client)) prev.client.destroy()
    }
    if (!cached.cfg) throw StorageNotConfigured()
    return { cfg: cached.cfg, client: (cached as { client: S3Client }).client }
  }

  return {
    async presignPut(Key, p) {
      const { cfg, client } = await current()
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: cfg.bucket, Key, ContentType: p.mime, ContentLength: p.sizeBytes }),
        { expiresIn: p.expiresSec, signableHeaders: new Set(["content-type", "content-length"]) },
      )
      return { method: "PUT", url, headers: { "Content-Type": p.mime, "Content-Length": String(p.sizeBytes) } }
    },
    async presignGet(Key, p) {
      const { cfg, client } = await current()
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: cfg.bucket, Key, ResponseContentType: p.mime, ResponseContentDisposition: `attachment; filename*=UTF-8''${rfc5987(p.name)}` }),
        { expiresIn: p.expiresSec },
      )
    },
    async copy(from, to, p) {
      const { cfg, client } = await current()
      try {
        await client.send(new CopyObjectCommand({ Bucket: cfg.bucket, Key: to, CopySource: `${cfg.bucket}/${from.split("/").map(encodeURIComponent).join("/")}`, CopySourceIfMatch: p?.ifMatchEtag }))
      } catch (e) {
        if (e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 412 || e.name === "PreconditionFailed")) throw new PreconditionFailedError()
        if (isMissing(e)) throw new ObjectMissingError()
        throw e
      }
    },
    async head(Key) {
      const { cfg, client } = await current()
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key }))
        return { size: r.ContentLength ?? 0, contentType: (r.ContentType ?? "").toLowerCase(), etag: r.ETag ?? "" }
      } catch (e) {
        if (isMissing(e)) return null
        throw e
      }
    },
    async getStream(Key) {
      const { cfg, client } = await current()
      const r = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key }))
      if (!(r.Body instanceof Readable)) throw new Error("storage returned no readable body")
      return r.Body
    },
    async put(Key, body, p) {
      const { cfg, client } = await current()
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key, Body: body, ContentType: p.contentType }))
    },
    async delete(Key) {
      const { cfg, client } = await current()
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key }))
    },
    async probe() {
      const { cfg, client } = await current()
      const Key = `_probe/${crypto.randomUUID()}`
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key, Body: "ok", ContentType: "text/plain" }))
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key }))
    },
    invalidate() {
      if (cached) cached = { ...cached, at: 0 } // stale now; the old client is reused only if the new config is identical
    },
    close() {
      if (cached && "client" in cached) cached.client.destroy()
      cached = null
    },
  }
}

const sameConfig = (a: S3Config, b: S3Config) =>
  a.endpoint === b.endpoint && a.region === b.region && a.bucket === b.bucket && a.accessKeyId === b.accessKeyId && a.secretAccessKey === b.secretAccessKey && a.forcePathStyle === b.forcePathStyle
