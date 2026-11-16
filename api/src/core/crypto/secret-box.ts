import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// AES-256-GCM. Format: v1:<iv b64>:<auth tag b64>:<ciphertext b64>. The version prefix lets the
// format change later without a flag day.
const VERSION = "v1"
const IV_LEN = 12
const TAG_LEN = 16

function checkKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("secret-box key must be exactly 32 bytes")
}

export function seal(plaintext: string, key: Buffer): string {
  checkKey(key)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN })
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
  const ivBuf = Buffer.from(iv, "base64")
  const tagBuf = Buffer.from(tag, "base64")
  // Enforce lengths: Node accepts shortened GCM tags, which would weaken forgery resistance.
  if (ivBuf.length !== IV_LEN) throw new Error("invalid iv length")
  if (tagBuf.length !== TAG_LEN) throw new Error("invalid auth tag length")
  const decipher = createDecipheriv("aes-256-gcm", key, ivBuf, { authTagLength: TAG_LEN })
  decipher.setAuthTag(tagBuf)
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8")
}
