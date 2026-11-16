import { randomBytes } from "node:crypto"
import { expect, test } from "vitest"
import { open, seal } from "./secret-box"

const key = randomBytes(32)

test("secret-box round-trips and rejects tampered ciphertext / wrong key", () => {
  const sealed = seal("re_secret_value_123", key)
  expect(sealed).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/)
  expect(sealed).not.toContain("re_secret")
  expect(open(sealed, key)).toBe("re_secret_value_123")
  // random IV: same plaintext seals differently
  expect(seal("re_secret_value_123", key)).not.toBe(sealed)

  const [v, iv, tag, ct] = sealed.split(":")
  const flipped = Buffer.from(ct, "base64")
  flipped[0] ^= 1
  expect(() => open([v, iv, tag, flipped.toString("base64")].join(":"), key)).toThrow()
  expect(() => open(sealed, randomBytes(32))).toThrow()
  expect(() => open(`v2:${iv}:${tag}:${ct}`, key)).toThrow(/version/i)
  expect(() => open("garbage", key)).toThrow()
})
test("secret-box requires a 32-byte key", () => {
  expect(() => seal("x", randomBytes(16))).toThrow(/32/)
})
