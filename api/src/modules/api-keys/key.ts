import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import type { Access, Module } from "@opsdesk/domain/permissions"
import { MODULES } from "../rbac/access"

/**
 * API key format (T3.6): `odk_<prefix>_<secret>`. `prefix` = 8 random base62 characters (public, unique: it is the lookup
 * handle, see api_key_index); `secret` = 32 random bytes in base64url (43 characters). Only sha256(full key) is stored.
 */
export const KEY_RE = /^odk_([0-9A-Za-z]{8})_([A-Za-z0-9_-]{43})$/
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** 8 base62 characters by rejection sampling (bytes >= 248 are dropped), so there is no modulo bias. */
function randomPrefix(): string {
  let out = ""
  while (out.length < 8) {
    for (const b of randomBytes(16)) {
      if (b < 248 && out.length < 8) out += BASE62[b % 62]
    }
  }
  return out
}

export function generateKey(): { key: string; prefix: string } {
  const prefix = randomPrefix()
  return { key: `odk_${prefix}_${randomBytes(32).toString("base64url")}`, prefix }
}

export const hashKey = (key: string): string => createHash("sha256").update(key).digest("hex")

/** The prefix of a well-formed key, else null. */
export function parseKey(raw: string): { prefix: string } | null {
  const m = KEY_RE.exec(raw)
  return m ? { prefix: m[1] } : null
}

/** Constant-time comparison of two sha256 hex digests. */
export function hashesEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex")
  const y = Buffer.from(b, "hex")
  return x.length === 32 && y.length === 32 && timingSafeEqual(x, y)
}

const RANK: Record<Access, number> = { none: 0, read: 1, write: 2 }
const ACCESS = ["none", "read", "write"] as const

/** `<module>:read|write` with a known module, else null (anything else is rejected, never guessed). */
export function parseScope(s: unknown): { module: Module; action: "read" | "write" } | null {
  if (typeof s !== "string") return null
  const m = /^([a-z]+):(read|write)$/.exec(s)
  if (!m || !(MODULES as readonly string[]).includes(m[1])) return null
  return { module: m[1] as Module, action: m[2] as "read" | "write" }
}

/**
 * Effective access of a key, at USE time: per module, min(scope level, the creator's CURRENT level). `write` implies `read`
 * for the same module only (same as the RBAC model: can() ranks none < read < write). A scope that does not parse grants
 * nothing, and a module without a scope is "none", so a key can never exceed its scopes nor its creator's role.
 */
export function effectiveAccess(scopes: readonly string[], creator: Record<string, string>): Record<Module, Access> {
  const out = Object.fromEntries(MODULES.map((m) => [m, "none" as Access])) as Record<Module, Access>
  for (const s of scopes) {
    const p = parseScope(s)
    if (!p) continue
    const have = (ACCESS as readonly string[]).includes(creator[p.module]) ? (creator[p.module] as Access) : "none"
    const level = RANK[p.action] < RANK[have] ? p.action : have
    if (RANK[level] > RANK[out[p.module]]) out[p.module] = level
  }
  return out
}

/** True when the creator's role holds at least `scope` (used at create time: scopes must be a subset of the creator's permissions). */
export function creatorHolds(scope: { module: Module; action: "read" | "write" }, creator: Record<string, string>): boolean {
  const have = (ACCESS as readonly string[]).includes(creator[scope.module]) ? (creator[scope.module] as Access) : "none"
  return RANK[have] >= RANK[scope.action]
}
