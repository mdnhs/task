import { readFileSync } from "node:fs"
import { describe, expect, test, vi } from "vitest"
import { HEARTBEAT_TTL_SECONDS, heartbeatKey, startHeartbeat } from "./heartbeat"

const fakeRedis = () => {
  const sets: Array<[string, string, string, number]> = []
  return { sets, redis: { set: vi.fn(async (k: string, v: string, mode: "EX", ttl: number) => void sets.push([k, v, mode, ttl])) } }
}

describe("worker heartbeat (compose healthcheck of the worker service)", () => {
  test("the key is per host and the TTL covers a missed beat or two", () => {
    expect(heartbeatKey("abc123")).toBe("worker:heartbeat:abc123")
    expect(HEARTBEAT_TTL_SECONDS).toBeGreaterThanOrEqual(30)
  })

  test("it beats at once, then on every interval, and stops on close", async () => {
    vi.useFakeTimers()
    try {
      const { redis, sets } = fakeRedis()
      const hb = startHeartbeat(redis, { host: "h1", intervalMs: 1000, now: () => new Date("2026-11-18T10:00:00Z") })
      await vi.advanceTimersByTimeAsync(0)
      expect(sets).toHaveLength(1)
      expect(sets[0]).toEqual(["worker:heartbeat:h1", "2026-11-18T10:00:00.000Z", "EX", HEARTBEAT_TTL_SECONDS])
      await vi.advanceTimersByTimeAsync(3000)
      expect(sets).toHaveLength(4)
      hb.stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(sets).toHaveLength(4)
    } finally {
      vi.useRealTimers()
    }
  })

  test("a Redis error never throws out of the timer (the worker keeps working, the healthcheck fails by itself)", async () => {
    vi.useFakeTimers()
    try {
      const redis = { set: vi.fn(async () => { throw new Error("down") }) }
      const hb = startHeartbeat(redis, { host: "h1", intervalMs: 1000 })
      await expect(vi.advanceTimersByTimeAsync(3000)).resolves.not.toThrow()
      hb.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  test("the standalone healthcheck script reads the same key the worker writes", () => {
    const script = readFileSync(new URL("../../../scripts/worker-healthcheck.mjs", import.meta.url), "utf8")
    expect(script).toContain("worker:heartbeat:")
    expect(script).toContain("hostname()")
  })
})
