import { createCipheriv, randomBytes } from "node:crypto"
import { expect, test } from "vitest"
import { buildKeyring, isCurrent, open, seal, type Keyring } from "./secret-box"

const AAD = "platform.email.api_key"
const ring: Keyring = { current: { id: "k1", key: randomBytes(32) } }

/** A legacy v1 ciphertext (single key, no AAD), as stored before T2.0. */
function sealV1(plain: string, key: Buffer): string {
  const iv = randomBytes(12)
  const c = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 })
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()])
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":")
}

test("secret-box v2 round-trips and rejects tampered ciphertext / wrong key", () => {
  const sealed = seal("re_secret_value_123", ring, AAD)
  expect(sealed).toMatch(/^v2:k1:[^:]+:[^:]+:[^:]+$/)
  expect(sealed).not.toContain("re_secret")
  expect(open(sealed, ring, AAD)).toBe("re_secret_value_123")
  // random IV: same plaintext seals differently
  expect(seal("re_secret_value_123", ring, AAD)).not.toBe(sealed)

  const [v, kid, iv, tag, ct] = sealed.split(":")
  const flipped = Buffer.from(ct, "base64")
  flipped[0] ^= 1
  expect(() => open([v, kid, iv, tag, flipped.toString("base64")].join(":"), ring, AAD)).toThrow()
  expect(() => open(sealed, { current: { id: "k1", key: randomBytes(32) } }, AAD)).toThrow()
  expect(() => open(`v9:${kid}:${iv}:${tag}:${ct}`, ring, AAD)).toThrow(/version/i)
  expect(() => open("garbage", ring, AAD)).toThrow()
})
test("secret-box v2 binds AAD: opening with a different purpose throws", () => {
  const s = seal("re_x", ring, AAD)
  expect(() => open(s, ring, "integration:t:google")).toThrow()
})
test("secret-box requires 32-byte keys and a sane key id", () => {
  expect(() => seal("x", { current: { id: "k1", key: randomBytes(16) } }, AAD)).toThrow(/32/)
  expect(() => seal("x", { current: { id: "bad:id", key: randomBytes(32) } }, AAD)).toThrow(/key id/)
})
test("secret-box rejects a truncated auth tag and a wrong-length IV", () => {
  const [v, kid, iv, tag, ct] = seal("re_secret_value_123", ring, AAD).split(":")
  const trunc = Buffer.from(tag, "base64").subarray(0, 4).toString("base64")
  expect(() => open([v, kid, iv, trunc, ct].join(":"), ring, AAD)).toThrow(/tag/i)
  const shortIv = Buffer.from(iv, "base64").subarray(0, 8).toString("base64")
  expect(() => open([v, kid, shortIv, tag, ct].join(":"), ring, AAD)).toThrow(/iv/i)
})
test("secret-box opens v1 ciphertexts (no AAD) and a rotated keyring opens old-kid v2", () => {
  const v1 = sealV1("legacy", ring.current.key)
  expect(open(v1, ring, AAD)).toBe("legacy")
  expect(isCurrent(v1, ring)).toBe(false)

  const old = seal("old-secret", ring, AAD)
  const rotated: Keyring = { current: { id: "k2", key: randomBytes(32) }, previous: [ring.current] }
  expect(open(old, rotated, AAD)).toBe("old-secret")
  expect(isCurrent(old, rotated)).toBe(false)
  expect(isCurrent(seal("n", rotated, AAD), rotated)).toBe(true)
  // v1 written under a now-previous key still opens
  expect(open(v1, rotated, AAD)).toBe("legacy")
  // an unknown kid is refused
  expect(() => open(old, { current: { id: "k9", key: randomBytes(32) } }, AAD)).toThrow(/key id/i)
})
test("buildKeyring: SECRETS_KEY is k1; SECRETS_KEYS + SECRETS_KEY_ID selects current and keeps the rest as previous", () => {
  const a = randomBytes(32), b = randomBytes(32)
  const single = buildKeyring({ SECRETS_KEY: a.toString("base64") })
  expect(single.current.id).toBe("k1")
  expect(single.current.key.equals(a)).toBe(true)
  const multi = buildKeyring({ SECRETS_KEYS: JSON.stringify({ k1: a.toString("base64"), k2: b.toString("base64") }), SECRETS_KEY_ID: "k2" })
  expect(multi.current.id).toBe("k2")
  expect(multi.previous?.map((k) => k.id)).toEqual(["k1"])
  expect(() => buildKeyring({})).toThrow(/SECRETS_KEY/)
  expect(() => buildKeyring({ SECRETS_KEYS: JSON.stringify({ k1: a.toString("base64") }), SECRETS_KEY_ID: "zz" })).toThrow(/SECRETS_KEY_ID/)
})
