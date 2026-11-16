import { Queue as BullQueue, Worker } from "bullmq"
import { Redis } from "ioredis"
import type { Deps } from "../../deps"
import { runJob, type Queue } from "./queue"

export const QUEUE_NAME = "opsdesk"

const connect = (url: string) => new Redis(url, { maxRetriesPerRequest: null })

/** BullMQ-backed Queue over REDIS_URL. close() releases the Redis connection. */
export function makeBullQueue(redisUrl: string, name: string = QUEUE_NAME): Queue & { raw: BullQueue } {
  const connection = connect(redisUrl)
  const raw = new BullQueue(name, { connection })
  return {
    raw,
    add: async (jobName, data, opts) => {
      await raw.add(jobName, data ?? {}, { delay: opts?.delayMs, jobId: opts?.jobId, removeOnComplete: { age: 86400 }, removeOnFail: { age: 7 * 86400 } })
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
  worker.on("failed", (job, err) => deps.logger.error({ job: job?.name, error: err.message }, "job failed"))
  return {
    close: async () => {
      await worker.close()
      connection.disconnect()
    },
  }
}
