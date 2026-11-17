import type { Context } from "hono"
import type { AppEnv } from "../../core/context"

// F18: the in-process read-model cache. 30 s TTL, at most 2000 entries (LRU), one key builder, busted per tenant after a write by THIS instance (other instances catch up within the TTL).
// What makes it safe: (1) the route guards (M1, permission) run BEFORE the cache is asked; (2) the key holds the tenant, the model, EVERYTHING the data depends on about the caller (task scope,
// report scope, attention access, and the user for a personal model) and whether Drive text is shown; (3) a stored value is a copy, so no caller can change what the next one gets;
// (4) support sessions are never cached (ttl 0).

export const READ_MODEL_TTL_MS = 30_000
export const READ_MODEL_MAX = 2000

type Entry = { value: unknown; expires: number }
const store = new Map<string, Entry>() // insertion order = recency (a hit re-inserts)
const generation = new Map<string, number>() // per tenant: bumped by every bust, so a load that started before a bust is not stored

const KEY = /^rm:([^:]+):/
const tenantOf = (key: string): string => {
  const m = KEY.exec(key)
  if (!m) throw new Error("read-model cache key must start with rm:<tenantId>:")
  return m[1]
}

/** The ONE function that builds a key: `rm:<tenantId>:<model>:<scopeKey>:<drive0|drive1>:<localDay>`. `scopeKey` is built by `scopeKeyOf` (scope.ts) and carries the caller's scope and, for personal models, the user. */
export function readModelKey(c: Context<AppEnv>, model: string, scopeKey: string, drive: boolean, localDay: string): string {
  return `rm:${c.get("tenant")!.id}:${model}:${scopeKey}:${drive ? "drive1" : "drive0"}:${localDay}`
}

/** 0 for a support session (never cached: it is not the tenant's member and is audited per request), else the TTL. */
export const readModelTtl = (support: boolean): number => (support ? 0 : READ_MODEL_TTL_MS)

/** The cached value (a copy) while it is younger than `ttlMs` of `now` (deps.clock), else `load()`. A `ttlMs` of 0 never reads or stores. */
export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>, now: Date): Promise<T> {
  const tenant = tenantOf(key)
  if (ttlMs <= 0) return load()
  const hit = store.get(key)
  if (hit && hit.expires > now.getTime()) {
    store.delete(key)
    store.set(key, hit)
    return structuredClone(hit.value) as T
  }
  if (hit) store.delete(key)
  const gen = generation.get(tenant) ?? 0
  const value = await load()
  if ((generation.get(tenant) ?? 0) === gen) {
    store.set(key, { value: structuredClone(value), expires: now.getTime() + ttlMs })
    while (store.size > READ_MODEL_MAX) store.delete(store.keys().next().value as string)
  }
  return value
}

/** Drops every entry of the tenant (after a write by this instance) and invalidates the loads in flight. */
export function bustReadModels(tenantId: string): void {
  generation.set(tenantId, (generation.get(tenantId) ?? 0) + 1)
  const prefix = `rm:${tenantId}:`
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k)
}

/** Test and diagnostics: the keys held now. Never values. */
export const cacheKeys = (): string[] => [...store.keys()]
export function resetReadModelCache(): void {
  store.clear()
  generation.clear()
}
