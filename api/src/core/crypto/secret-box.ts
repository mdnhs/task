import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// AES-256-GCM. Current format (v2): v2:<kid>:<iv b64>:<auth tag b64>:<ciphertext b64>. The key id selects the key from the
// keyring (rotation: add the new key, make it current, keep old ones as previous). The AAD (a purpose string such as
// "platform.email.api_key") is authenticated but not stored, so a ciphertext cannot be moved to another column/purpose.
// v1 (v1:<iv>:<tag>:<ct>, single key, no AAD) is still opened so existing rows migrate lazily; seal() never writes it.
const IV_LEN = 12
const TAG_LEN = 16
const KID = /^[A-Za-z0-9_-]{1,32}$/

export type KeyEntry = { id: string; key: Buffer }
export type Keyring = { current: KeyEntry; previous?: KeyEntry[] }

function checkKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("secret-box key must be exactly 32 bytes")
}
function checkEntry(e: KeyEntry): void {
  if (!KID.test(e.id)) throw new Error("secret-box key id must match [A-Za-z0-9_-]{1,32}")
  checkKey(e.key)
}
function allKeys(ring: Keyring): KeyEntry[] {
  return [ring.current, ...(ring.previous ?? [])]
}

export function seal(plaintext: string, ring: Keyring, aad: string): string {
  checkEntry(ring.current)
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv("aes-256-gcm", ring.current.key, iv, { authTagLength: TAG_LEN })
  cipher.setAAD(Buffer.from(aad, "utf8"))
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return ["v2", ring.current.id, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":")
}

function decrypt(key: Buffer, iv: string, tag: string, ct: string, aad?: string): string {
  checkKey(key)
  const ivBuf = Buffer.from(iv, "base64")
  const tagBuf = Buffer.from(tag, "base64")
  // Enforce lengths: Node accepts shortened GCM tags, which would weaken forgery resistance.
  if (ivBuf.length !== IV_LEN) throw new Error("invalid iv length")
  if (tagBuf.length !== TAG_LEN) throw new Error("invalid auth tag length")
  const decipher = createDecipheriv("aes-256-gcm", key, ivBuf, { authTagLength: TAG_LEN })
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, "utf8"))
  decipher.setAuthTag(tagBuf)
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8")
}

/** Throws on a wrong key/AAD, tampered data, an unknown key id or an unknown version. */
export function open(sealed: string, ring: Keyring, aad: string): string {
  const parts = sealed.split(":")
  const version = parts[0]
  if (version === "v2") {
    if (parts.length !== 5) throw new Error("malformed sealed value")
    const [, kid, iv, tag, ct] = parts
    const entry = allKeys(ring).find((k) => k.id === kid)
    if (!entry) throw new Error("unknown secret-box key id")
    return decrypt(entry.key, iv, tag, ct, aad)
  }
  if (version === "v1") {
    if (parts.length !== 4) throw new Error("malformed sealed value")
    const [, iv, tag, ct] = parts
    // v1 carries no key id and no AAD: try each key. Only used until the row is re-sealed.
    let last: unknown = new Error("no keys")
    for (const k of allKeys(ring)) {
      try {
        return decrypt(k.key, iv, tag, ct)
      } catch (e) {
        last = e
      }
    }
    throw last
  }
  throw new Error(`unsupported secret-box version: ${version}`)
}

/** True when the value is already v2 under the current key id (nothing to re-seal). */
export function isCurrent(sealed: string, ring: Keyring): boolean {
  const p = sealed.split(":")
  return p[0] === "v2" && p[1] === ring.current.id
}

export type KeyringEnv = { SECRETS_KEY?: string; SECRETS_KEYS?: string; SECRETS_KEY_ID?: string }

/** Parses SECRETS_KEYS JSON {"<kid>": "<base64 32 bytes>"}; shared by env validation and buildKeyring. */
export function parseKeyMap(raw: string): Record<string, string> {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    throw new Error("must be a JSON object")
  }
  if (typeof v !== "object" || v === null || Array.isArray(v) || Object.keys(v).length === 0) throw new Error("must be a non-empty JSON object")
  for (const [kid, b64] of Object.entries(v)) {
    if (!KID.test(kid)) throw new Error(`invalid key id "${kid}"`)
    if (typeof b64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || Buffer.from(b64, "base64").length !== 32) {
      throw new Error(`key "${kid}" must be base64 of exactly 32 bytes`)
    }
  }
  return v as Record<string, string>
}

/** SECRETS_KEYS + SECRETS_KEY_ID when set; otherwise SECRETS_KEY as the single key with id "k1". */
export function buildKeyring(env: KeyringEnv): Keyring {
  if (env.SECRETS_KEYS) {
    const map = parseKeyMap(env.SECRETS_KEYS)
    const id = env.SECRETS_KEY_ID
    if (!id || !(id in map)) throw new Error("SECRETS_KEY_ID must name a key in SECRETS_KEYS")
    const entry = (k: string): KeyEntry => ({ id: k, key: Buffer.from(map[k], "base64") })
    return { current: entry(id), previous: Object.keys(map).filter((k) => k !== id).map(entry) }
  }
  if (!env.SECRETS_KEY) throw new Error("SECRETS_KEY is not set")
  return { current: { id: "k1", key: Buffer.from(env.SECRETS_KEY, "base64") } }
}
