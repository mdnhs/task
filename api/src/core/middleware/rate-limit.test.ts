import { expect, test } from "vitest"
import pino from "pino"
import { AppError, problem } from "../errors"
import { newRouter } from "../router"
import { fakeClock, fakeRateLimiter } from "../../../test/fakes"
import { clientIp, ipBucket } from "../net/client-ip"
import { rateLimit } from "./rate-limit"
import type { Deps } from "../../deps"

const RULE = { limit: 3, windowSec: 60 }

function build(hops = 1) {
  const clock = fakeClock()
  const limiter = fakeRateLimiter(clock)
  const app = newRouter()
  app.use("*", async (c, next) => {
    c.set("deps", { rateLimiter: limiter, env: { TRUST_PROXY_HOPS: hops }, logger: pino({ level: "silent" }), clock } as unknown as Deps)
    c.set("requestId", "rid-1")
    await next()
  })
  app.onError((err) => (err instanceof AppError ? problem(err.status, err.code, err.title, "rid-1", err.extra) : problem(500, "internal", "x", "rid-1")))
  const keyOf = (c: Parameters<Parameters<typeof rateLimit>[2]>[0]) => ipBucket(clientIp(c.req.raw.headers, undefined, c.get("deps").env.TRUST_PROXY_HOPS))
  app.get("/read", rateLimit("read", RULE, keyOf), (c) => c.json({ ok: true }))
  app.post("/auth", rateLimit("auth", RULE, keyOf, { failClosed: true }), (c) => c.json({ ok: true }))
  return { app, limiter, clock }
}
const get = (app: ReturnType<typeof build>["app"], path: string, xff: string, method = "GET") => app.request(path, { method, headers: { "x-forwarded-for": xff } })

test("rate limiter 429 carries retry-after and problem+json code rate_limited", async () => {
  const { app, clock } = build()
  for (let i = 0; i < 3; i++) expect((await get(app, "/auth", "5.5.5.5", "POST")).status).toBe(200)
  clock.advance({ minutes: 0 })
  const r = await get(app, "/auth", "5.5.5.5", "POST")
  expect(r.status).toBe(429)
  expect(r.headers.get("content-type")).toContain("application/problem+json")
  expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0)
  expect(Number(r.headers.get("retry-after"))).toBeLessThanOrEqual(60)
  expect(((await r.json()) as { code: string }).code).toBe("rate_limited")
  clock.advance({ minutes: 2 })
  expect((await get(app, "/auth", "5.5.5.5", "POST")).status).toBe(200) // window passed
})
test("forged x-forwarded-for does not give a caller a fresh bucket", async () => {
  const { app } = build(1)
  // the proxy appended the real address (5.5.5.5) on the right; the client prepends a new fake one each time
  for (let i = 0; i < 3; i++) expect((await get(app, "/auth", `10.0.0.${i}, 5.5.5.5`, "POST")).status).toBe(200)
  expect((await get(app, "/auth", "10.9.9.9, 5.5.5.5", "POST")).status).toBe(429)
  expect((await get(app, "/auth", "10.9.9.9,   ,5.5.5.5", "POST")).status).toBe(429)
  // a different real client is unaffected
  expect((await get(app, "/auth", "10.9.9.9, 6.6.6.6", "POST")).status).toBe(200)
  // IPv6: another address in the same /64 is the same bucket
  for (let i = 0; i < 3; i++) expect((await get(app, "/read", `2001:db8:0:1::${i + 1}`)).status).toBe(200)
  expect((await get(app, "/read", "2001:db8:0:1:ffff::9")).status).toBe(429)
})
test("with hops 0 a forged header is ignored (every caller shares the socket bucket)", async () => {
  const { app } = build(0)
  for (let i = 0; i < 3; i++) expect((await get(app, "/read", `7.7.7.${i}`)).status).toBe(200)
  expect((await get(app, "/read", "8.8.8.8")).status).toBe(429)
})
test("limiter store down: auth fails closed (503), reads fail open", async () => {
  const { app, limiter } = build()
  limiter.down = true
  const a = await get(app, "/auth", "5.5.5.5", "POST")
  expect(a.status).toBe(503)
  expect(((await a.json()) as { code: string }).code).toBe("rate_limit_unavailable")
  expect((await get(app, "/read", "5.5.5.5")).status).toBe(200)
  limiter.down = false
  expect((await get(app, "/auth", "5.5.5.5", "POST")).status).toBe(200)
})

import { randomUUID } from "node:crypto"
import { Redis } from "ioredis"
import { makeRedisRateLimiter } from "./rate-limit"

test("the Redis limiter counts in a fixed window, resets, claims once, and rejects when the store is unreachable", async () => {
  const l = makeRedisRateLimiter(process.env.REDIS_URL!)
  const k = `t-${randomUUID()}`
  try {
    const rule = { limit: 2, windowSec: 60 }
    expect(await l.hit(k, rule)).toMatchObject({ allowed: true, remaining: 1 })
    expect(await l.hit(k, rule)).toMatchObject({ allowed: true, remaining: 0 })
    const third = await l.hit(k, rule)
    expect(third.allowed).toBe(false)
    expect(third.retryAfterSec).toBeGreaterThan(0)
    expect(third.retryAfterSec).toBeLessThanOrEqual(60)
    // a counter that lost its TTL (crash between INCR and EXPIRE, manual SET) is re-armed, never a permanent block
    const raw = new Redis(process.env.REDIS_URL!)
    try {
      await raw.set(`rl:${k}-ttl`, "9")
      expect((await l.hit(`${k}-ttl`, rule)).allowed).toBe(false)
      expect(await raw.ttl(`rl:${k}-ttl`)).toBeGreaterThan(0)
    } finally {
      raw.disconnect()
    }
    await l.reset(k)
    expect((await l.hit(k, rule)).allowed).toBe(true)
    expect(await l.once(`${k}-c`, 30)).toBe(true)
    expect(await l.once(`${k}-c`, 30)).toBe(false)
  } finally {
    await l.close()
  }
  const dead = makeRedisRateLimiter("redis://127.0.0.1:1")
  try {
    await expect(dead.hit("x", { limit: 1, windowSec: 1 })).rejects.toBeDefined()
    await expect(dead.once("x", 1)).rejects.toBeDefined()
  } finally {
    await dead.close()
  }
})
