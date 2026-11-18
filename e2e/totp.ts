import { createHmac } from "node:crypto"

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for the seeded console operator, whose key is the raw string the seed was given. */
export function totp(rawKey: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const h = createHmac("sha1", Buffer.from(rawKey)).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0")
}
