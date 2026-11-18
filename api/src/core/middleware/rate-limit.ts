import { createHash } from "node:crypto"
import type { Context, MiddlewareHandler } from "hono"
import { Redis } from "ioredis"
import type { AppEnv } from "../context"
import { AppError, problem } from "../errors"
import { errorInfo } from "../safe-error"

export type RateRule = { limit: number; windowSec: number }
export type RateResult = { allowed: boolean; remaining: number; retryAfterSec: number }

/**
 * Shared limiter store (ruling S4). Fixed window: the first hit of a key opens a window of `windowSec`, every hit
 * counts, the window ends on its own. Any method rejects when the store is unreachable; callers decide fail-open or closed.
 */
export interface RateLimiter {
  hit(key: string, rule: RateRule): Promise<RateResult>
  /** Forgets a counter (a successful TOTP verification clears the failure count). */
  reset(key: string): Promise<void>
  /** Claims `key` for `ttlSec`; false when it is already claimed (a TOTP code used once). */
  once(key: string, ttlSec: number): Promise<boolean>
  /** Reachability of the store, for /readyz (B7 Task 15). Rejects when it is down. */
  ping?(): Promise<void>
}

/** The fixed limits of ruling S4 (per user for TOTP and tenant creation, per address for mail). The auth per-IP limit is env: AUTH_RATE_LIMIT_PER_MIN. */
export const RATE = {
  authMailAddress: { limit: 5, windowSec: 3600 },
  inviteMailAddress: { limit: 5, windowSec: 3600 },
  totpFailures: { limit: 5, windowSec: 900 },
  tenantCreateUser: { limit: 10, windowSec: 3600 },
} as const satisfies Record<string, RateRule>
/** A used TOTP code is refused for this long (Better Auth accepts the current and the previous 30 s step; the margin covers clock skew). */
export const TOTP_REPLAY_TTL_SEC = 120

const SCRIPT = `
local c = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if c == 1 or ttl < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {c, ttl}
`

/** Redis limiter. A command waits at most `commandTimeout` (it queues only while the first connection is made) and then rejects, so a request never hangs on the limiter while Redis is down. */
export function makeRedisRateLimiter(redisUrl: string): RateLimiter & { close(): Promise<void> } {
  const redis = new Redis(redisUrl, { commandTimeout: 1500, maxRetriesPerRequest: 1, connectTimeout: 2000, retryStrategy: (n) => Math.min(n * 200, 2000) })
  redis.on("error", () => {}) // surfaced as rejections of the calls below; keeps the process alive while Redis is down
  const k = (key: string) => `rl:${key}`
  return {
    hit: async (key, rule) => {
      const [count, ttl] = (await redis.eval(SCRIPT, 1, k(key), String(rule.windowSec))) as [number, number]
      return { allowed: count <= rule.limit, remaining: Math.max(0, rule.limit - count), retryAfterSec: Math.max(1, ttl) }
    },
    reset: async (key) => {
      await redis.del(k(key))
    },
    once: async (key, ttlSec) => (await redis.set(k(`once:${key}`), "1", "EX", ttlSec, "NX")) === "OK",
    ping: async () => void (await redis.ping()),
    close: async () => {
      redis.disconnect()
    },
  }
}

/** Allows everything. For one-off scripts that never serve requests (demo seed); never wired into the server. */
export const noopRateLimiter: RateLimiter = {
  hit: async (_k, rule) => ({ allowed: true, remaining: rule.limit, retryAfterSec: 1 }),
  reset: async () => {},
  once: async () => true,
}

/** sha256 hex, for keys that would otherwise carry an email address into the store. */
export const hashKey = (v: string): string => createHash("sha256").update(v.trim().toLowerCase()).digest("hex")

export const rateLimited = (requestId: string, retryAfterSec: number): Response => {
  const res = problem(429, "rate_limited", "Too Many Requests", requestId)
  res.headers.set("retry-after", String(retryAfterSec))
  return res
}

/**
 * Counts one hit on `name:key` and answers 429 (problem+json `rate_limited`, Retry-After) when over the rule. When the store is
 * unreachable: `failClosed` answers 503 `rate_limit_unavailable`, otherwise the call is let through (reads fail open).
 * Returns a Response to send, or null to carry on.
 */
export async function enforceRateLimit(c: Context<AppEnv>, name: string, rule: RateRule, key: string, opts: { failClosed?: boolean } = {}): Promise<Response | null> {
  const deps = c.get("deps")
  try {
    const r = await deps.rateLimiter.hit(`${name}:${key}`, rule)
    if (r.allowed) return null
    deps.metrics.counter("rate_limited_total", { bucket: name }).inc()
    return rateLimited(c.get("requestId"), r.retryAfterSec)
  } catch (err) {
    deps.logger.warn({ ...errorInfo(err), limiter: name, failClosed: opts.failClosed === true, requestId: c.get("requestId") }, "rate limiter store unavailable")
    if (opts.failClosed) throw new AppError(503, "rate_limit_unavailable", "Service Unavailable")
    return null
  }
}

/** Like enforceRateLimit, for handlers whose return type is fixed: throws the 429 (with Retry-After) instead of returning it. */
export async function assertRateLimit(c: Context<AppEnv>, name: string, rule: RateRule, key: string, opts: { failClosed?: boolean } = {}): Promise<void> {
  const blocked = await enforceRateLimit(c, name, rule, key, opts)
  if (blocked) throw new AppError(429, "rate_limited", "Too Many Requests", undefined, { "retry-after": blocked.headers.get("retry-after") ?? "60" })
}

export function rateLimit(name: string, rule: RateRule, keyOf: (c: Context<AppEnv>) => string, opts: { failClosed?: boolean } = {}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const blocked = await enforceRateLimit(c, name, rule, keyOf(c), opts)
    if (blocked) return blocked
    await next()
  }
}
