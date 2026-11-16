import { Queue as BullQueue, Worker } from "bullmq"
import { Redis } from "ioredis"
import type { Logger } from "pino"
import type { Deps } from "../../deps"
import { errorInfo } from "../safe-error"
import { runJob, type Queue } from "./queue"

export const QUEUE_NAME = "opsdesk"

/** Worker connection: blocks and retries forever (BullMQ requires maxRetriesPerRequest null). */
const connect = (url: string) => new Redis(url, { maxRetriesPerRequest: null })

/**
 * Producer connection (HTTP requests): commands fail at once while Redis is down (no offline queue) and a command is
 * retried at most once, so `queue.add` rejects fast instead of hanging the request. The socket keeps reconnecting.
 */
const connectProducer = (url: string) =>
  new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2000, retryStrategy: (times) => Math.min(times * 200, 2000) })

/** `queue.add` gives up after this long even if BullMQ is still waiting for the connection. */
export const ADD_TIMEOUT_MS = 3000

/** Worker `failed` log: job name, error class and a safe code only. Never err.message (Drizzle messages contain query params). */
export function logJobFailure(logger: Logger, job: { name?: string } | undefined, err: unknown): void {
  logger.error({ job: job?.name, ...errorInfo(err) }, "job failed")
}

/** BullMQ-backed Queue over REDIS_URL. close() releases the Redis connection. */
export function makeBullQueue(redisUrl: string, name: string = QUEUE_NAME): Queue & { raw: BullQueue } {
  const connection = connectProducer(redisUrl)
  connection.on("error", () => {}) // surfaced as add() rejections; keeps the process alive while Redis is down
  const raw = new BullQueue(name, { connection })
  raw.on("error", () => {})
  return {
    raw,
    add: async (jobName, data, opts) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          raw.add(jobName, data ?? {}, { delay: opts?.delayMs, jobId: opts?.jobId, removeOnComplete: { age: 86400 }, removeOnFail: { age: 7 * 86400 } }),
          new Promise<never>((_, reject) => (timer = setTimeout(() => reject(Object.assign(new Error("queue add timed out"), { name: "QueueTimeout", code: "queue_timeout" })), ADD_TIMEOUT_MS))),
        ])
      } finally {
        clearTimeout(timer)
      }
    },
    close: async () => {
      await raw.close()
      connection.disconnect()
    },
  }
}

/** Starts a BullMQ worker that dispatches by job name to registerJob handlers. */
export function startWorker(deps: Deps, redisUrl: string, name: string = QUEUE_NAME): { close(): Promise<void> } {
  const connection = connect(redisUrl)
  const worker = new Worker(name, (job) => runJob(job.name, job.data, deps), { connection })
  worker.on("failed", (job, err) => logJobFailure(deps.logger, job, err))
  return {
    close: async () => {
      await worker.close()
      connection.disconnect()
    },
  }
}
