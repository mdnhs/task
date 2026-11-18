import { Queue as BullQueue, Worker } from "bullmq"
import { Redis } from "ioredis"
import type { Logger } from "pino"
import type { Deps } from "../../deps"
import { errorInfo } from "../safe-error"
import { REQUEST_ID } from "../middleware/request-id"
import { safeCapture } from "../observability/error-reporter"
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

type JobLike = { name?: string; id?: string; data?: unknown }
/** The request id a job was enqueued under, when its data carries one that is id-shaped. Nothing else of the payload is ever read. */
const jobRequestId = (job: JobLike | undefined): string | undefined => {
  const id = (job?.data as { requestId?: unknown } | null | undefined)?.requestId
  return typeof id === "string" && REQUEST_ID.test(id) ? id : undefined
}

/** Worker `failed` log: job name, job id, request id (when present), error class and a safe code only. Never err.message (Drizzle messages contain query params) and never the payload. */
export function logJobFailure(logger: Logger, job: JobLike | undefined, err: unknown): void {
  const requestId = jobRequestId(job)
  logger.error({ job: job?.name, jobId: job?.id, ...(requestId ? { requestId } : {}), ...errorInfo(err) }, "job failed")
}

/** One job run: queue_jobs_total{name,result}, queue_job_duration_seconds{name} (deps.clock), and a failure goes to the error reporter before it is rethrown to BullMQ. */
export async function instrumentJob(d: Pick<Deps, "metrics" | "errorReporter" | "clock">, job: JobLike, run: () => Promise<void>): Promise<void> {
  const started = d.clock.now().getTime()
  const name = job.name ?? "unknown"
  try {
    await run()
    d.metrics.counter("queue_jobs_total", { name, result: "ok" }).inc()
  } catch (err) {
    d.metrics.counter("queue_jobs_total", { name, result: "failed" }).inc()
    const requestId = jobRequestId(job)
    safeCapture(d.errorReporter, err, { jobName: name, ...(job.id ? { jobId: job.id } : {}), ...(requestId ? { requestId } : {}) })
    throw err
  } finally {
    d.metrics.histogram("queue_job_duration_seconds", { name }).observe((d.clock.now().getTime() - started) / 1000)
  }
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
    ping: async () => void (await connection.ping()),
    close: async () => {
      await raw.close()
      connection.disconnect()
    },
  }
}

/** Starts a BullMQ worker that dispatches by job name to registerJob handlers. */
export function startWorker(deps: Deps, redisUrl: string, name: string = QUEUE_NAME): { close(): Promise<void> } {
  const connection = connect(redisUrl)
  const worker = new Worker(name, (job) => instrumentJob(deps, job, () => runJob(job.name, job.data, deps)), { connection })
  worker.on("failed", (job, err) => logJobFailure(deps.logger, job, err))
  return {
    close: async () => {
      await worker.close()
      connection.disconnect()
    },
  }
}
