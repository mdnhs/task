import { eq } from "drizzle-orm"
import { buildKeyring, open, seal, type KeyringEnv } from "../../core/crypto/secret-box"
import { AppError } from "../../core/errors"
import { makeS3Storage, type S3Config } from "../../core/storage/s3-storage"
import type { Storage } from "../../core/storage/storage"
import type { Db } from "../../db/client"
import { platformStorageSettings as t } from "../../db/schema"
import type { Deps } from "../../deps"
import type { Env } from "../../env"
import type { AuditSnapshot, PlatformAuditSink } from "../platform-email"

export type StorageSettings =
  | { configured: false }
  | { configured: true; provider: "r2"; accountId: string; bucket: string; accessKeyId: string; secretLast4: string; updatedAt: Date; updatedBy: string | null }

export type StorageSettingsDeps = Pick<Deps, "env" | "clock"> & { storage: Pick<Storage, "invalidate">; audit: PlatformAuditSink }

/** AAD binding the stored R2 secret to its column; a ciphertext copied elsewhere will not open. */
export const STORAGE_SECRET_AAD = "platform.storage.r2.secret_access_key"

/** R2's S3 endpoint is derived from the account id (path-style, region "auto"). */
export const r2Endpoint = (accountId: string) => `https://${accountId}.r2.cloudflarestorage.com`

const snapshot = (s: StorageSettings): AuditSnapshot =>
  s.configured ? { configured: true, accountId: s.accountId, bucket: s.bucket, accessKeyId: s.accessKeyId, secretLast4: s.secretLast4 } : { configured: false }

export async function getStorageSettings(db: Db): Promise<StorageSettings> {
  const [r] = await db.select().from(t).where(eq(t.id, 1))
  if (!r) return { configured: false }
  return { configured: true, provider: "r2", accountId: r.accountId, bucket: r.bucket, accessKeyId: r.accessKeyId, secretLast4: r.secretLast4, updatedAt: r.updatedAt, updatedBy: r.updatedBy }
}

const bad = (code: string, title: string) => new AppError(400, code, title)

export async function setStorageSettings(
  db: Db,
  deps: StorageSettingsDeps,
  input: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey?: string },
  actorId: string,
): Promise<void> {
  const accountId = input.accountId.trim().toLowerCase()
  const bucket = input.bucket.trim()
  const accessKeyId = input.accessKeyId.trim()
  const secret = input.secretAccessKey?.trim()
  if (!/^[0-9a-f]{32}$/.test(accountId)) throw bad("invalid_account_id", "Invalid account id")
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw bad("invalid_bucket", "Invalid bucket name")
  if (!/^[A-Za-z0-9]{16,128}$/.test(accessKeyId)) throw bad("invalid_access_key_id", "Invalid access key id")
  if (secret !== undefined && !/^[A-Za-z0-9+/=_-]{32,128}$/.test(secret)) throw bad("invalid_secret_access_key", "Invalid secret access key")

  const before = await getStorageSettings(db)
  if (!before.configured && !secret) throw bad("secret_required", "Secret access key required")

  const now = deps.clock.now()
  const values = { accountId, bucket, accessKeyId, updatedBy: actorId, updatedAt: now }
  if (secret) {
    const v = { ...values, secretAccessKeyCiphertext: seal(secret, buildKeyring(deps.env), STORAGE_SECRET_AAD), secretLast4: secret.slice(-4) }
    await db.insert(t).values({ id: 1, ...v }).onConflictDoUpdate({ target: t.id, set: v })
  } else {
    await db.update(t).set(values).where(eq(t.id, 1))
  }
  const after = await getStorageSettings(db)
  await deps.audit.record({ action: "platform.storage_settings.updated", actorId, before: snapshot(before), after: snapshot(after), at: now })
  deps.storage.invalidate?.()
}

/** Decrypts the stored secret. Only the storage config source calls this. */
export async function loadStorageConfig(db: Db, env: KeyringEnv): Promise<S3Config | null> {
  const [r] = await db.select().from(t).where(eq(t.id, 1))
  if (!r) return null
  return {
    endpoint: r2Endpoint(r.accountId), region: "auto", bucket: r.bucket, forcePathStyle: true,
    accessKeyId: r.accessKeyId, secretAccessKey: open(r.secretAccessKeyCiphertext, buildKeyring(env), STORAGE_SECRET_AAD),
  }
}

/** Env bootstrap (S3_*), used only when no DB settings exist (and by tests against MinIO). */
export function envStorageConfig(env: Env): S3Config | null {
  if (!env.S3_BUCKET || !env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null
  return { endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, forcePathStyle: env.S3_FORCE_PATH_STYLE }
}

/**
 * The production Storage: config from the platform admin's DB settings (win), else the S3_* env bootstrap, else every
 * call fails closed with 503 storage_not_configured. Cached for 60 s; setStorageSettings calls invalidate().
 */
export function makeStorage({ env, db }: { env: Env; db: Db }): Storage & { invalidate(): void; close(): void } {
  return makeS3Storage({
    get: async () => {
      // Without SECRETS_KEY (dev) stored settings cannot be decrypted, so skip straight to env.
      const stored = env.SECRETS_KEY || env.SECRETS_KEYS ? await loadStorageConfig(db, env) : null
      return stored ?? envStorageConfig(env)
    },
  })
}

const MAX = 200
/** Safe-to-return description of a storage error: name and HTTP status, with anything key-like redacted. */
export function sanitizeStorageError(err: unknown): string {
  const e = err as { name?: unknown; message?: unknown; $metadata?: { httpStatusCode?: unknown } } | null
  const name = typeof e?.name === "string" ? e.name : "Error"
  const status = typeof e?.$metadata?.httpStatusCode === "number" ? ` ${e.$metadata.httpStatusCode}` : ""
  const raw = typeof e?.message === "string" ? e.message : "unknown error"
  const msg = raw.replace(/https?:\/\/\S+/g, "[redacted-url]").replace(/[A-Za-z0-9+/=_-]{16,}/g, "[redacted]").replace(/\s+/g, " ").slice(0, MAX)
  return `${name}${status}: ${msg}`
}

export async function testStorage(deps: { storage: Pick<Storage, "probe"> }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await deps.storage.probe()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: sanitizeStorageError(err) }
  }
}
