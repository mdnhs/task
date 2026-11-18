export type FakeClock = {
  now(): Date
  advance(d: { minutes?: number; hours?: number; days?: number }): void
}
export function fakeClock(start = new Date("2026-11-16T09:00:00Z")): FakeClock {
  let t = start.getTime()
  return {
    now: () => new Date(t),
    advance: (d) => {
      t += ((d.days ?? 0) * 24 * 60 + (d.hours ?? 0) * 60 + (d.minutes ?? 0)) * 60_000
    },
  }
}

export type MailMsg = { to: string; subject: string; text: string }
export type FakeMailer = {
  send(msg: MailMsg): Promise<void>
  sent: MailMsg[]
  last(): MailMsg
}
export function fakeMailer(): FakeMailer {
  const sent: MailMsg[] = []
  return {
    sent,
    send: async (msg) => { sent.push(msg) },
    last: () => sent[sent.length - 1],
  }
}

import type { RateLimiter } from "../src/core/middleware/rate-limit"
export type FakeRateLimiter = RateLimiter & { down: boolean; hits: string[] }
/** In-memory RateLimiter on the test clock (fixed windows like the Redis one). `down = true` simulates the store being unreachable. */
export function fakeRateLimiter(clock: { now(): Date }): FakeRateLimiter {
  const counters = new Map<string, { count: number; resetAt: number }>()
  const once = new Map<string, number>()
  const f: FakeRateLimiter = {
    down: false,
    hits: [],
    hit: async (key, rule) => {
      if (f.down) throw new Error("store down")
      f.hits.push(key)
      const now = clock.now().getTime()
      let w = counters.get(key)
      if (!w || w.resetAt <= now) {
        w = { count: 0, resetAt: now + rule.windowSec * 1000 }
        counters.set(key, w)
      }
      w.count += 1
      return { allowed: w.count <= rule.limit, remaining: Math.max(0, rule.limit - w.count), retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) }
    },
    reset: async (key) => {
      if (f.down) throw new Error("store down")
      counters.delete(key)
    },
    ping: async () => {
      if (f.down) throw new Error("store down")
    },
    once: async (key, ttlSec) => {
      if (f.down) throw new Error("store down")
      const now = clock.now().getTime()
      const until = once.get(key)
      if (until !== undefined && until > now) return false
      once.set(key, now + ttlSec * 1000)
      return true
    },
  }
  return f
}
