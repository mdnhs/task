import type { Context } from "hono"
import type { AppEnv } from "../../core/context"

// F18: the in-process read-model cache. 30 s TTL, at most 2000 entries (LRU), one key builder, busted per tenant after a write; other instances see the bust at once through a per-tenant version stamp in Redis (B7 S11), and fall back to the TTL when Redis is down.
// What makes it safe: (1) the route guards (M1, permission) run BEFORE the cache is asked; (2) the key holds the tenant, the model, EVERYTHING the data depends on about the caller (task scope,
// report scope, attention access, and the user for a personal model) and whether Drive text is shown; (3) a stored value is a copy, so no caller can change what the next one gets;
// (4) support sessions are never cached (ttl 0); (5) the Redis stamp `rm:v:<tenantId>` is a bare integer (no tenant data), one key per tenant, expiring after an hour without a bust; a read costs one GET.

export const READ_MODEL_TTL_MS = 30_000
export const READ_MODEL_MAX = 2000

/** Shared per-tenant version (Redis in production). Both methods may reject; the cache then falls back to its TTL (fail-open). */
export interface CacheStamp {
  /** Bumps the tenant's version (a bust). */
  incr(tenantId: string): Promise<void>
  /** The tenant's current version (0 when it was never bumped). */
  get(tenantId: string): Promise<number>
}

type Entry = { value: unknown; expires: number; stamp: number | null }

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

export type ReadModelCache = {
  /** The cached value (a copy) while it is younger than `ttlMs` of `now` (deps.clock) and the tenant's stamp has not moved, else `load()`. A `ttlMs` of 0 never reads or stores. */
  cached<T>(key: string, ttlMs: number, load: () => Promise<T>, now: Date): Promise<T>
  /** Drops this instance's entries of the tenant at once, invalidates the loads in flight, then bumps the shared stamp (not awaited) so other instances drop theirs. Never rejects (a Redis failure leaves them to the TTL). */
  bust(tenantId: string): Promise<void>
  /** Test and diagnostics: the keys held now. Never values. */
  keys(): string[]
  reset(): void
}

/** A stamp call that takes longer than this counts as failed (a hung, not refused, Redis). */
export const STAMP_TIMEOUT_MS = 100
/** After a failed or timed-out stamp call Redis is not asked again for this long (then one call probes it): a hung Redis costs one 100 ms wait per window, not one per request. */
export const STAMP_BREAKER_MS = 5000

const withTimeout = <T>(p: Promise<T>): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stamp timeout")), STAMP_TIMEOUT_MS)
    timer.unref?.()
    p.then(
      (v) => (clearTimeout(timer), resolve(v)),
      (e) => (clearTimeout(timer), reject(e)),
    )
  })

/**
 * One cache instance (one per process). Without a `stamp` it is the single-instance cache of F18. With one, a tiny circuit breaker (on `clock`, i.e. deps.clock) protects every
 * request from a slow Redis, and a bust never waits for it. A Redis flush or restart resets the stamps to 0: an entry stored under the same small number within its 30 s
 * could then match again, which is no worse than the TTL fallback this cache already accepts.
 */
export function makeReadModelCache(stamp?: CacheStamp, o: { clock?: { now(): Date }; onError?: (err: unknown) => void } = {}): ReadModelCache {
  if (stamp && !o.clock) throw new Error("makeReadModelCache: a stamp needs a clock (deps.clock)")
  const clock = o.clock ?? { now: () => new Date(0) } // only read when there is a stamp
  let skipUntil = 0
  const trip = (err: unknown) => {
    skipUntil = clock.now().getTime() + STAMP_BREAKER_MS
    o.onError?.(err)
  }
  const store = new Map<string, Entry>() // insertion order = recency (a hit re-inserts)
  const generation = new Map<string, number>() // per tenant: bumped by every local bust, so a load that started before a bust is not stored
  const readStamp = async (tenant: string): Promise<number | null> => {
    if (!stamp || clock.now().getTime() < skipUntil) return null
    try {
      return await withTimeout(stamp.get(tenant))
    } catch (err) {
      trip(err)
      return null // Redis down or hung: the 30 s TTL is the only bound, never an error
    }
  }
  return {
    async cached<T>(key: string, ttlMs: number, load: () => Promise<T>, now: Date): Promise<T> {
      const tenant = tenantOf(key)
      if (ttlMs <= 0) return load()
      const cur = await readStamp(tenant)
      const hit = store.get(key)
      if (hit && hit.expires > now.getTime() && (cur === null || hit.stamp === cur)) {
        store.delete(key)
        store.set(key, hit)
        return structuredClone(hit.value) as T
      }
      if (hit) store.delete(key)
      const gen = generation.get(tenant) ?? 0
      const value = await load()
      if ((generation.get(tenant) ?? 0) === gen) {
        store.set(key, { value: structuredClone(value), expires: now.getTime() + ttlMs, stamp: cur }) // a bust elsewhere during the load moves the stamp, so this entry is then not served
        while (store.size > READ_MODEL_MAX) store.delete(store.keys().next().value as string)
      }
      return value
    },
    bust(tenantId: string): Promise<void> {
      generation.set(tenantId, (generation.get(tenantId) ?? 0) + 1)
      const prefix = `rm:${tenantId}:`
      for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k)
      // The shared stamp is bumped without waiting (the request must not pay for Redis); a failure trips the breaker and other instances fall back to the TTL.
      if (stamp && clock.now().getTime() >= skipUntil) withTimeout(stamp.incr(tenantId)).catch(trip)
      return Promise.resolve()
    },
    keys: () => [...store.keys()],
    reset() {
      store.clear()
      generation.clear()
    },
  }
}

/** The process-wide default (no shared stamp): what tests and single-instance runs use. The server builds its own with the Redis stamp. */
export const defaultReadModelCache = makeReadModelCache()
export const cached = defaultReadModelCache.cached
export const bustReadModels = defaultReadModelCache.bust
export const cacheKeys = defaultReadModelCache.keys
export const resetReadModelCache = defaultReadModelCache.reset
