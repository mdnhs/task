import { Readable } from "node:stream"
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3"
import { createPresignedPost } from "@aws-sdk/s3-presigned-post"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type { Env } from "../../env"
import type { Storage } from "./storage"

export type S3Config = { endpoint?: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean }

/** RFC 5987 `ext-value` encoding for Content-Disposition filename*: percent-encode everything but attr-chars. */
export function rfc5987(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

const isMissing = (e: unknown): boolean => e instanceof S3ServiceException && (e.$metadata.httpStatusCode === 404 || e.name === "NotFound" || e.name === "NoSuchKey")

export function makeS3Storage(cfg: S3Config): Storage & { close(): void } {
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  const Bucket = cfg.bucket
  return {
    async presignPost(Key, o) {
      const { url, fields } = await createPresignedPost(client, {
        Bucket,
        Key,
        Expires: o.expiresSec,
        Fields: { "Content-Type": o.mime },
        Conditions: [["content-length-range", 1, o.maxBytes], ["eq", "$Content-Type", o.mime]],
      })
      return { url, fields }
    },
    presignGet: (Key, o) =>
      getSignedUrl(
        client,
        new GetObjectCommand({ Bucket, Key, ResponseContentType: o.mime, ResponseContentDisposition: `attachment; filename*=UTF-8''${rfc5987(o.name)}` }),
        { expiresIn: o.expiresSec },
      ),
    async head(Key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key }))
        return { size: r.ContentLength ?? 0, contentType: (r.ContentType ?? "").toLowerCase(), etag: r.ETag ?? "" }
      } catch (e) {
        if (isMissing(e)) return null
        throw e
      }
    },
    async getStream(Key) {
      const r = await client.send(new GetObjectCommand({ Bucket, Key }))
      if (!(r.Body instanceof Readable)) throw new Error("storage returned no readable body")
      return r.Body
    },
    async delete(Key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key }))
    },
    close: () => client.destroy(),
  }
}

/** The adapter for this process's env, or null when storage is not configured. */
export function s3FromEnv(env: Env): (Storage & { close(): void }) | null {
  if (!env.S3_BUCKET || !env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null
  return makeS3Storage({ endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, forcePathStyle: env.S3_FORCE_PATH_STYLE })
}
