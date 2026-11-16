import { createCipheriv, randomBytes } from "node:crypto"
import { beforeEach, expect, test, vi } from "vitest"
import { ownerQuery } from "../../../test/db"
import { resetDb, testApp } from "../../../test/harness"
import { loadMailConfig } from "./service"
import { getEmailSettings, sendTestEmail, setEmailSettings } from "./index"
import { platformAuditEntries } from "../../../test/platform-audit"
import { testDb } from "../../../test/db"

const KEY = "re_test_key_aaaaaaaaaaaa1234"
const b64 = randomBytes(32).toString("base64")
beforeEach(resetDb)

function ctx() {
  const t = testApp({ env: { ...testApp().deps.env, SECRETS_KEY: b64 } })
  const invalidate = vi.fn()
  const deps = { env: t.deps.env, clock: t.clock, mailer: Object.assign(t.mailer, { invalidate }) }
  return { ...t, deps, invalidate, db: testDb() }
}
const input = { apiKey: KEY, fromAddress: "no-reply@x.ie", fromName: "OpsDesk" }

test("getEmailSettings never exposes the key; shows last4", async () => {
  const { db, deps } = ctx()
  expect(await getEmailSettings(db)).toEqual({ configured: false })
  await setEmailSettings(db, deps, input, "admin-1")
  const s = await getEmailSettings(db)
  expect(s).toMatchObject({ configured: true, provider: "resend", fromAddress: "no-reply@x.ie", fromName: "OpsDesk", keyLast4: "1234", updatedBy: "admin-1" })
  expect(JSON.stringify(s)).not.toContain(KEY)
  const [row] = await ownerQuery("select api_key_ciphertext, api_key_last4 from platform_email_settings")
  expect(row.api_key_ciphertext).toMatch(/^v2:k1:/)
  expect(String(row.api_key_ciphertext)).not.toContain(KEY)
  expect(row.api_key_last4).toBe("1234")
})
test("setEmailSettings requires apiKey on first save; keeps old key when apiKey omitted later", async () => {
  const { db, deps, invalidate } = ctx()
  await expect(setEmailSettings(db, deps, { fromAddress: "a@x.ie", fromName: "A" }, "u")).rejects.toMatchObject({ code: "api_key_required" })
  await setEmailSettings(db, deps, input, "u")
  const [before] = await ownerQuery("select api_key_ciphertext from platform_email_settings")
  await setEmailSettings(db, deps, { fromAddress: "new@x.ie", fromName: "New" }, "u2")
  const [after] = await ownerQuery("select api_key_ciphertext, from_address from platform_email_settings")
  expect(after.api_key_ciphertext).toBe(before.api_key_ciphertext)
  expect(after.from_address).toBe("new@x.ie")
  expect(await ownerQuery("select id from platform_email_settings")).toHaveLength(1)
  expect(invalidate).toHaveBeenCalledTimes(2)
})
test("setEmailSettings rejects invalid fromAddress and malformed key", async () => {
  const { db, deps } = ctx()
  await expect(setEmailSettings(db, deps, { ...input, fromAddress: "not-an-email" }, "u")).rejects.toMatchObject({ code: "invalid_from_address" })
  await expect(setEmailSettings(db, deps, { ...input, fromName: "A\r\nBcc: x@y.z" }, "u")).rejects.toMatchObject({ code: "invalid_from_name" })
  await expect(setEmailSettings(db, deps, { ...input, apiKey: "sk_live_1234567890123456789" }, "u")).rejects.toMatchObject({ code: "invalid_api_key" })
  await expect(setEmailSettings(db, deps, { ...input, apiKey: "re_short" }, "u")).rejects.toMatchObject({ code: "invalid_api_key" })
  expect(await ownerQuery("select id from platform_email_settings")).toEqual([])
})
test("setEmailSettings writes an audit entry without the key", async () => {
  const { db, deps } = ctx()
  await setEmailSettings(db, deps, input, "admin-1")
  await setEmailSettings(db, deps, { apiKey: "re_other_key_bbbbbbbbbb9999", fromAddress: "no-reply@x.ie", fromName: "OpsDesk" }, "admin-1")
  const entries = await platformAuditEntries()
  expect(entries).toHaveLength(2)
  expect(entries[0]).toMatchObject({ action: "platform.email_settings.updated", actorId: "admin-1", before: { configured: false }, after: { configured: true, keyLast4: "1234" } })
  expect(entries[1]).toMatchObject({ before: { keyLast4: "1234" }, after: { keyLast4: "9999" } })
  const dump = JSON.stringify(entries)
  expect(dump).not.toContain("re_test_key")
  expect(dump).not.toContain("re_other_key")
  expect(dump).not.toContain("ciphertext")
  expect(dump).not.toContain("no-reply@x.ie") // the raw sender address is stored as an HMAC + domain only
})
test("app_user cannot delete the settings row", async () => {
  const { db, deps } = ctx()
  await setEmailSettings(db, deps, input, "u")
  await expect(db.$client.query("delete from platform_email_settings")).rejects.toThrow(/permission denied/)
})
test("setEmailSettings needs SECRETS_KEY", async () => {
  const t = testApp()
  const env = { ...t.deps.env, SECRETS_KEY: undefined }
  await expect(setEmailSettings(testDb(), { env, clock: t.clock, mailer: t.mailer }, input, "u")).rejects.toThrow(/SECRETS_KEY/)
})
test("sendTestEmail sends a fixed message through the mailer", async () => {
  const { deps, mailer } = ctx()
  expect(await sendTestEmail(deps, "to@x.ie")).toEqual({ ok: true })
  expect(mailer.last()).toMatchObject({ to: "to@x.ie" })
})
test("sendTestEmail returns sanitized error when the SDK rejects", async () => {
  const { deps } = ctx()
  deps.mailer.send = async () => { throw new Error("401 invalid key re_test_key_aaaaaaaaaaaa1234 body=secret") }
  const r = await sendTestEmail(deps, "to@x.ie")
  expect(r.ok).toBe(false)
  expect(JSON.stringify(r)).not.toContain("re_test_key")
  expect(await sendTestEmail(deps, "bad")).toMatchObject({ ok: false })
})

test("getEmailSettings path lazily re-seals a v1 ciphertext to v2 on first load, without audit or updated_at change", async () => {
  const { db, deps } = ctx()
  await setEmailSettings(db, deps, input, "u")
  // Rewrite the row as a legacy v1 value (no AAD, single key).
  const key = Buffer.from(b64, "base64")
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 })
  const ct = Buffer.concat([c.update(KEY, "utf8"), c.final()])
  const v1 = ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":")
  await ownerQuery("update platform_email_settings set api_key_ciphertext = $1", [v1])
  const [b4] = await ownerQuery("select updated_at from platform_email_settings")
  const auditBefore = (await platformAuditEntries()).length

  expect((await loadMailConfig(db, deps.env))?.apiKey).toBe(KEY)
  const [row] = await ownerQuery("select api_key_ciphertext, updated_at from platform_email_settings")
  expect(row.api_key_ciphertext).toMatch(/^v2:k1:/)
  expect(row.updated_at).toEqual(b4.updated_at)
  expect((await platformAuditEntries()).length).toBe(auditBefore)
  expect((await loadMailConfig(db, deps.env))?.apiKey).toBe(KEY)
})
