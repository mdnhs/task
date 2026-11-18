// The worker has no port, so its container healthcheck cannot call it. Instead it writes "I am alive" into Redis every few seconds and
// scripts/worker-healthcheck.mjs (the compose healthcheck) reads that key. One key per host (the container id), so a second replica
// cannot keep a dead first one looking healthy. Redis down: the beat fails quietly and the key expires, which is what the check should see.
export const HEARTBEAT_TTL_SECONDS = 45
export const heartbeatKey = (host: string): string => `worker:heartbeat:${host}`

export function startHeartbeat(
  redis: { set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown> },
  o: { host: string; intervalMs?: number; now?: () => Date },
): { stop(): void } {
  const now = o.now ?? (() => new Date())
  const beat = () => {
    redis.set(heartbeatKey(o.host), now().toISOString(), "EX", HEARTBEAT_TTL_SECONDS).catch(() => {})
  }
  beat()
  const timer = setInterval(beat, o.intervalMs ?? 10_000)
  timer.unref()
  return { stop: () => clearInterval(timer) }
}
