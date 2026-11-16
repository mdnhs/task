import type { Readable } from "node:stream"

/** S3 presigned POST: the browser sends `fields` first, then the file as the LAST multipart field, to `url`. */
export type PresignedPost = { url: string; fields: Record<string, string> }
export type ObjectHead = { size: number; contentType: string; etag: string }

/**
 * Object storage behind the files module. Keys are chosen by the server (`t/<tenantId>/<fileId>`, see fileKey), never by
 * a client. The real adapter is S3Storage (S3-compatible, tested against MinIO).
 */
export type Storage = {
  /** Presigned POST valid for `expiresSec`: exact key, exact Content-Type, 1 <= size <= maxBytes. */
  presignPost(key: string, o: { mime: string; maxBytes: number; expiresSec: number }): Promise<PresignedPost>
  /** Presigned GET valid for `expiresSec`, forcing a download (`attachment`) with the stored mime. */
  presignGet(key: string, o: { name: string; mime: string; expiresSec: number }): Promise<string>
  /** null when the object does not exist. */
  head(key: string): Promise<ObjectHead | null>
  /** Streams the object (chunked; the caller must consume or destroy it). */
  getStream(key: string): Promise<Readable>
  /** Idempotent: deleting a missing key succeeds. */
  delete(key: string): Promise<void>
}

/** The only place an object key is built. Inputs are server-generated uuids, never client text. */
export function fileKey(tenantId: string, fileId: string): string {
  return `t/${tenantId}/${fileId}`
}

/** Used when S3_* is not configured (development without storage): every call fails closed. */
export function unconfiguredStorage(): Storage {
  const fail = (): never => {
    throw new Error("storage is not configured (set S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)")
  }
  return { presignPost: async () => fail(), presignGet: async () => fail(), head: async () => fail(), getStream: async () => fail(), delete: async () => fail() }
}
