import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// AES-256-GCM. Format: v1:<iv b64>:<auth tag b64>:<ciphertext b64>. The version prefix lets the
// format change later without a flag day.
const VERSION = "v1"

function checkKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("secret-box key must be exactly 32 bytes")
}

export function seal(plaintext: string, key: Buffer): string {
  checkKey(key)
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":")
}

/** Throws on a wrong key, tampered data or an unknown version. */
export function open(sealed: string, key: Buffer): string {
  checkKey(key)
  const parts = sealed.split(":")
  if (parts.length !== 4) throw new Error("malformed sealed value")
  const [version, iv, tag, ct] = parts
  if (version !== VERSION) throw new Error(`unsupported secret-box version: ${version}`)
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"))
  decipher.setAuthTag(Buffer.from(tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8")
}
