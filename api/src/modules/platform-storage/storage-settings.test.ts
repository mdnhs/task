import { randomBytes } from "node:crypto"
import { beforeEach, expect, test } from "vitest"
import { ownerQuery, ownerTenantQuery, testDb } from "../../../test/db"
import { call, resetDb, testApp, testEnv } from "../../../test/harness"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { buildKeyring, open } from "../../core/crypto/secret-box"
import { InMemoryAuditSink } from "../platform-email"
import { getStorageSettings, makeStorage, setStorageSettings, STORAGE_SECRET_AAD, testStorage } from "."

beforeEach(resetDb)

const ACCOUNT = "0123456789abcdef0123456789abcdef"
const SECRET = "r2-secret-access-key-ABCDEFGHIJKLMNOP9876"
const input = { accountId: ACCOUNT, bucket: "opsdesk-files", accessKeyId: "AKIAR2EXAMPLEKEY0001", secretAccessKey: SECRET }
const b64 = randomBytes(32).toString("base64")

function ctx(env: Partial<typeof testEnv> = {}) {
  const e = { ...testEnv, SECRETS_KEY: b64, ...env }
  const db = testDb()
  const storage = makeStorage({ env: e, db })
  const t = testApp({ env: e, storage })
  const audit = new InMemoryAuditSink()
  return { ...t, env: e, db, storage, audit, sdeps: { env: e, clock: t.clock, storage, audit } }
}

test("getStorageSettings never exposes the secret; the stored secret is sealed with the purpose AAD", async () => {
  const { db, sdeps, env } = ctx()
  expect(await getStorageSettings(db)).toEqual({ configured: false })
  await setStorageSettings(db, sdeps, input, "admin-1")
  const s = await getStorageSettings(db)
  expect(s).toMatchObject({ configured: true, provider: "r2", accountId: ACCOUNT, bucket: "opsdesk-files", accessKeyId: input.accessKeyId, secretLast4: "9876", updatedBy: "admin-1" })
  expect(JSON.stringify(s)).not.toContain(SECRET)
  const [row] = await ownerQuery("select secret_access_key_ciphertext as c, secret_last4 from platform_storage_settings")
  expect(String(row.c)).toMatch(/^v2:k1:/)
  expect(String(row.c)).not.toContain(SECRET)
  const ring = buildKeyring(env)
  expect(open(String(row.c), ring, STORAGE_SECRET_AAD)).toBe(SECRET)
  expect(STORAGE_SECRET_AAD).toBe("platform.storage.r2.secret_access_key")
  expect(() => open(String(row.c), ring, "platform.email.api_key")).toThrow() // bound to its purpose
})

test("first save requires the secret; omitting it later keeps the old one; validation errors", async () => {
  const { db, sdeps } = ctx()
  const { secretAccessKey: _s, ...noSecret } = input
  await expect(setStorageSettings(db, sdeps, noSecret, "u")).rejects.toMatchObject({ code: "secret_required" })
  await setStorageSettings(db, sdeps, input, "u")
  const [before] = await ownerQuery("select secret_access_key_ciphertext as c from platform_storage_settings")
  await setStorageSettings(db, sdeps, { ...noSecret, bucket: "other-bucket" }, "u2")
  const [after] = await ownerQuery("select secret_access_key_ciphertext as c, bucket from platform_storage_settings")
  expect(after.c).toBe(before.c)
  expect(after.bucket).toBe("other-bucket")
  expect(await ownerQuery("select 1 from platform_storage_settings")).toHaveLength(1)
  await expect(setStorageSettings(db, sdeps, { ...input, accountId: "nope" }, "u")).rejects.toMatchObject({ code: "invalid_account_id" })
  await expect(setStorageSettings(db, sdeps, { ...input, bucket: "Bad Bucket!" }, "u")).rejects.toMatchObject({ code: "invalid_bucket" })
  await expect(setStorageSettings(db, sdeps, { ...input, accessKeyId: "a b" }, "u")).rejects.toMatchObject({ code: "invalid_access_key_id" })
  await expect(setStorageSettings(db, sdeps, { ...input, secretAccessKey: "short" }, "u")).rejects.toMatchObject({ code: "invalid_secret_access_key" })
})

test("the audit entry never contains the secret", async () => {
  const { db, sdeps, audit } = ctx()
  await setStorageSettings(db, sdeps, input, "admin-1")
  expect(audit.entries).toHaveLength(1)
  expect(audit.entries[0]).toMatchObject({ action: "platform.storage_settings.updated", actorId: "admin-1" })
  const text = JSON.stringify(audit.entries)
  expect(text).not.toContain(SECRET)
  expect(text).not.toContain("secret_access_key")
})

test("saving invalidates the storage config cache: new settings are picked up immediately, and the endpoint is derived", async () => {
  const { db, sdeps, storage } = ctx({ S3_BUCKET: undefined, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined, S3_ENDPOINT: undefined })
  await expect(storage.head("u/x/y")).rejects.toMatchObject({ status: 503, code: "storage_not_configured" }) // caches "none"
  await setStorageSettings(db, sdeps, input, "u")
  const url = await storage.presignGet("t/a/b", { name: "n.pdf", mime: "application/pdf", expiresSec: 60 })
  const u = new URL(url)
  expect(u.host).toBe(`${ACCOUNT}.r2.cloudflarestorage.com`)
  expect(u.pathname).toBe("/opsdesk-files/t/a/b") // path style
  expect(u.searchParams.get("X-Amz-Credential")).toContain(`${input.accessKeyId}/`)
  expect(u.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/")
  await setStorageSettings(db, sdeps, { ...input, bucket: "second-bucket" }, "u")
  expect(new URL(await storage.presignGet("t/a/b", { name: "n.pdf", mime: "application/pdf", expiresSec: 60 })).pathname).toBe("/second-bucket/t/a/b")
})

test("production with neither DB settings nor env fails closed: the files routes answer 503 storage_not_configured and create nothing", async () => {
  const { app, deps } = ctx({ NODE_ENV: "production", S3_BUCKET: undefined, S3_REGION: undefined, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined, S3_ENDPOINT: undefined })
  const tenant = await makeTenant(deps)
  const owner = await makeMember(deps, tenant.id, "owner")
  const cookie = (await signIn(app, owner.email, owner.password)).cookie
  const r = await call(app, "POST", "/v1/files/uploads", { cookie, tenant: tenant.slug, body: { name: "a.pdf", mime: "application/pdf", sizeBytes: 5 } })
  expect(r.status).toBe(503)
  expect(r.headers.get("content-type")).toContain("application/problem+json")
  expect(((await r.json()) as { code: string }).code).toBe("storage_not_configured")
  expect(await ownerTenantQuery(tenant.id, "select 1 from files")).toEqual([])
})

test("testStorage probes put+delete and returns a sanitized error that never echoes keys", async () => {
  const { db, sdeps, storage } = ctx({ S3_BUCKET: undefined, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined, S3_ENDPOINT: undefined })
  expect(await testStorage({ storage })).toMatchObject({ ok: false })
  await setStorageSettings(db, sdeps, { ...input, accountId: "ffffffffffffffffffffffffffffffff" }, "u") // unreachable host
  const bad = await testStorage({ storage })
  expect(bad.ok).toBe(false)
  const text = JSON.stringify(bad)
  expect(text).not.toContain(SECRET)
  expect(text).not.toContain(input.accessKeyId)
  // with the MinIO env fallback (no DB row) the probe succeeds
  await ownerQuery("truncate platform_storage_settings")
  storage.invalidate()
  const e = ctx()
  expect(await testStorage({ storage: e.storage })).toEqual({ ok: true })
})
