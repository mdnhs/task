import type { Readable } from "node:stream"

/**
 * Presigned PUT (works on S3, MinIO and Cloudflare R2, which has no presigned POST). The client must send exactly
 * `headers` (Content-Type and Content-Length are part of the signature) to `url` with method PUT.
 */
export type PresignedPut = { method: "PUT"; url: string; headers: Record<string, string> }
export type ObjectHead = { size: number; contentType: string; etag: string }

/**
 * Object storage behind the files module. Keys are chosen by the server (`t/<tenantId>/<fileId>`, see fileKey), never by
 * a client. The real adapter is S3Storage (S3-compatible, tested against MinIO).
 */
export type Storage = {
  /** Presigned PUT valid for `expiresSec`: exact key, exact Content-Type and Content-Length signed into the URL. */
  presignPut(key: string, o: { mime: string; sizeBytes: number; expiresSec: number }): Promise<PresignedPut>
  /** Presigned GET valid for `expiresSec`, forcing a download (`attachment`) with the stored mime. */
  presignGet(key: string, o: { name: string; mime: string; expiresSec: number }): Promise<string>
  /**
   * Server-side copy `from` -> `to`, keeping content type. With `ifMatchEtag` it fails with `PreconditionFailedError`
   * when the source changed since that ETag was read.
   */
  copy(from: string, to: string, o?: { ifMatchEtag?: string }): Promise<void>
  /** null when the object does not exist. */
  head(key: string): Promise<ObjectHead | null>
  /** Writes a whole (small, server-generated) object, replacing any existing one. Used for DSR exports. */
  put(key: string, body: Buffer, o: { contentType: string }): Promise<void>
  /** Streams the object (chunked; the caller must consume or destroy it). */
  getStream(key: string): Promise<Readable>
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: string): Promise<void>
  /** Writes and deletes a throw-away object (settings "test connection"). Rejects when storage is unusable. */
  probe(): Promise<void>
  /** Drops cached configuration (called after the platform admin saves storage settings). */
  invalidate?(): void
}

/** The only place an object key is built. Inputs are server-generated uuids, never client text. */
export function fileKey(tenantId: string, fileId: string): string {
  return `t/${tenantId}/${fileId}`
}

/**
 * The upload (staging) key: the ONLY key a presigned PUT ever names. Never served and never scanned; `complete` copies
 * the verified object to fileKey(), a key no client-usable policy contains.
 */
export function stagingKey(tenantId: string, fileId: string): string {
  return `u/${tenantId}/${fileId}`
}

export class ObjectMissingError extends Error {
  constructor() {
    super("storage object missing")
    this.name = "ObjectMissingError"
  }
}

export class PreconditionFailedError extends Error {
  constructor() {
    super("storage precondition failed")
    this.name = "PreconditionFailedError"
  }
}

/** Used when S3_* is not configured (development without storage): every call fails closed. */
export function unconfiguredStorage(): Storage {
  const fail = (): never => {
    throw new Error("storage is not configured (set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)")
  }
  return { presignPut: async () => fail(), probe: async () => fail(), put: async () => fail(), presignGet: async () => fail(), copy: async () => fail(), head: async () => fail(), getStream: async () => fail(), delete: async () => fail() }
}
