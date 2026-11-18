// Container healthcheck of the worker service: exit 0 when this container's heartbeat key is in Redis (written by src/core/queue/heartbeat.ts).
//   node scripts/worker-healthcheck.mjs      (REDIS_URL from the container env)
// The key name is the same as heartbeatKey(): worker:heartbeat:<hostname> (a test keeps the two in step). Prints nothing secret.
import { hostname } from "node:os"
import Redis from "ioredis"

const redis = new Redis(process.env.REDIS_URL ?? "", { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 3000, commandTimeout: 3000, retryStrategy: () => null })
redis.on("error", () => {})
const done = (code) => {
  redis.disconnect()
  process.exit(code)
}
try {
  await redis.connect()
  done((await redis.exists(`worker:heartbeat:${hostname()}`)) === 1 ? 0 : 1)
} catch {
  done(1)
}
