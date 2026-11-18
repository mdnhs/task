import { Queue as BullQueue, Worker } from "bullmq"
import { Redis } from "ioredis"
import type { Logger } from "pino"
import type { Deps } from "../../deps"
import { errorInfo } from "../safe-error"
import { safeCapture } from "../observability/error-reporter"
import { runJob, type Queue } from "./queue"
import { stampRequestId, validRequestId } from "./request-context"

export const QUEUE_NAME = "opsdesk"

/** Worker connection: blocks and retries forever (BullMQ requires maxRetriesPerRequest null). */
const connect = (url: string) => {
  const r = new Redis(url, { maxRetriesPerRequest: null })
  r.on("error", () => {}) // reconnects on its own; an unhandled `error` would end the worker process
  return r
}

/**
 * Producer connection (HTTP requests): commands fail at once while Redis is down (no offline queue) and a command is
 * retried at most once, so `queue.add` rejects fast instead of hanging the request. The socket keeps reconnecting.
 */
const connectProducer = (url: string) =>
  new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 2000, retryStrategy: (times) => Math.min(times * 200, 2000) })

/** `queue.add` gives up after this long even if BullMQ is still waiting for the connection. */
export const ADD_TIMEOUT_MS = 3000

type JobLike = { name?: string; id?: string; data?: unknown; opts?: unknown }
/**
 * The request id a job was enqueued under: the one in its ENVELOPE (job options), when id-shaped. An older job whose payload happens to hold an id-shaped `requestId` field is still logged under it
 * (log correlation only: nothing else of the payload is ever read and it is never an identifier for authorization).
 */
export const jobRequestId = (job: JobLike | undefined): string | undefined =>
  validRequestId((job?.opts as { requestId?: unknown } | null | undefined)?.requestId) ?? validRequestId((job?.data as { requestId?: unknown } | null | undefined)?.requestId)

/** Tenant-scoped jobs that change what a read model shows (the tenant id is in the job data). The sweeps that do (recurrence, archive purge) bust per tenant themselves. Others (notification, webhook, export) are left out on purpose: busting for them would only thrash the cache. */
export const READ_MODEL_JOBS = new Set(["file.scan", "dsr.erase"])

/** After a worker job that wrote tenant data: bust that tenant's read-model cache (this process and, through the Redis stamp, every API instance). Never throws. */
export async function bustAfterJob(d: Pick<Deps, "readModelCache">, job: JobLike): Promise<void> {
  const tenantId = (job.data as { tenantId?: unknown } | null | undefined)?.tenantId
  if (job.name && READ_MODEL_JOBS.has(job.name) && typeof tenantId === "string" && tenantId.length > 0) await d.readModelCache.bust(tenantId)
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
      const requestId = stampRequestId(opts?.requestId) // envelope, not data: job schemas, ledgers and jobIds are untouched
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          raw.add(jobName, data ?? {}, { delay: opts?.delayMs, jobId: opts?.jobId, removeOnComplete: { age: 86400 }, removeOnFail: { age: 7 * 86400 }, ...(requestId ? ({ requestId } as object) : {}) }),
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
  const worker = new Worker(name, (job) => instrumentJob(deps, job, async () => {
      const requestId = jobRequestId(job)
      const jobDeps = requestId ? { ...deps, logger: deps.logger.child({ requestId }) } : deps // the handler logs with the id of the request (or event) that caused the job
      try {
        await runJob(job.name, job.data, jobDeps)
      } finally {
        await bustAfterJob(deps, job) // a failed job may have committed part of its work
      }
    }), { connection })
  worker.on("failed", (job, err) => logJobFailure(deps.logger, job, err))
  worker.on("error", (err) => deps.logger.error(errorInfo(err), "worker error")) // BullMQ emits connection and internal errors here; with no listener they would be thrown
  return {
    close: async () => {
      await worker.close()
      connection.disconnect()
    },
  }
}
