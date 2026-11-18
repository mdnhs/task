import { Redis } from "ioredis"
import type { CacheStamp } from "./cache"

/** The stamp lives an hour after the last bust: far longer than the 30 s entries it guards, so an expired stamp can never revive an entry. */
export const STAMP_TTL_SEC = 3600

/**
 * Redis version stamp for the read-model cache (B7 S11): `rm:v:<tenantId>` holds a bare integer (never tenant data). One key per tenant, always with a TTL.
 * Commands fail at once while Redis is down or connecting (no offline queue) and give up after 300 ms, so a read or a write never waits on it; the cache then rides on its TTL.
 */
export function makeRedisCacheStamp(redisUrl: string): CacheStamp & { close(): Promise<void> } {
  const redis = new Redis(redisUrl, { enableOfflineQueue: false, commandTimeout: 300, maxRetriesPerRequest: 1, connectTimeout: 2000, retryStrategy: (n) => Math.min(n * 200, 2000) })
  redis.on("error", () => {})
  /** Right after start-up the first connection is still being made: wait for it (at most the command timeout), once. Reconnecting or closed fails at once. */
  const ready = async (): Promise<void> => {
    if (redis.status === "ready" || (redis.status !== "connecting" && redis.status !== "connect" && redis.status !== "wait")) return
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer)
        redis.off("ready", done)
        resolve()
      }
      const timer = setTimeout(done, 300)
      redis.once("ready", done)
    })
  }
  const k = (tenantId: string) => `rm:v:${tenantId}`
  return {
    incr: async (tenantId) => {
      await ready()
      const res = await redis.multi().incr(k(tenantId)).expire(k(tenantId), STAMP_TTL_SEC).exec()
      const failed = res?.find(([err]) => err)
      if (failed) throw failed[0]
    },
    get: async (tenantId) => {
      await ready()
      return Number((await redis.get(k(tenantId))) ?? 0)
    },
    close: async () => {
      redis.disconnect()
    },
  }
}
