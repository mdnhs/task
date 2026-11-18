import { pathToFileURL } from "node:url"
import { relayOnce } from "./core/events"
import { makeBullQueue, startWorker } from "./core/queue/bull-queue"
import { registerJob } from "./core/queue/queue"
import { registerFiles } from "./modules/files"
import { registerGdpr, SWEEP_JOB } from "./modules/gdpr"
import { registerIntegrations } from "./modules/integrations"
import { NOTIFICATION_SWEEP_JOB, registerNotifications } from "./modules/notifications"
import { registerSearchIndexers } from "./modules/search"
import { DEADLINE_JOB, EXPORT_SWEEP_JOB, registerShiftReports } from "./modules/shift-reports"
import { ARCHIVE_PURGE_JOB, RECURRENCE_JOB, registerTasks } from "./modules/tasks"
import { registerWebhooks, SWEEP_JOB as WEBHOOK_SWEEP_JOB } from "./modules/webhooks-out"
import { parseEnv, type Env } from "./env"
import { makeDeps, startInternalMetrics } from "./server"

/** Background worker process: BullMQ job handlers plus the 1 s `events.relay` repeatable job. */
export async function startWorkerProcess(env: Env = parseEnv(process.env)) {
  const deps = makeDeps(env, { service: "worker" })
  const metricsServer = await startInternalMetrics(deps, env.WORKER_METRICS_PORT)
  registerNotifications() // notification.send job + member.joined subscriber
  registerSearchIndexers() // search index: members, teams, files
  registerFiles() // file.scan + file.delete-object jobs
  registerIntegrations() // integration.refresh job (token refresh is otherwise lazy, see getAccessToken)
  registerWebhooks() // webhook.deliver + webhook.sweep jobs and the event fan-out subscriber (T3.6)
  registerGdpr() // core DSR handlers + dsr.export / dsr.erase / dsr.export-expire jobs
  registerTasks() // tasks DSR handler (after the core ones: it runs before the membership is removed by the erase job) + the tasks.recurrence and tasks.archive-purge jobs
  registerShiftReports() // shift-reports DSR handler (after the core ones: it runs before the membership is removed by the erase job)
  registerJob("events.relay", async (_data, d) => {
    await relayOnce(d)
  })
  const worker = startWorker(deps, env.REDIS_URL)
  const queue = makeBullQueue(env.REDIS_URL)
  await queue.raw.upsertJobScheduler("events.relay", { every: 1000 }, { name: "events.relay", opts: { removeOnComplete: true, removeOnFail: 100 } })
  await queue.raw.upsertJobScheduler(SWEEP_JOB, { every: 5 * 60_000 }, { name: SWEEP_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } }) // re-enqueue lost/stale data requests
  await queue.raw.upsertJobScheduler(NOTIFICATION_SWEEP_JOB, { every: 5 * 60_000 }, { name: NOTIFICATION_SWEEP_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } }) // re-enqueue lost/stale deliveries
  await queue.raw.upsertJobScheduler(WEBHOOK_SWEEP_JOB, { every: 5 * 60_000 }, { name: WEBHOOK_SWEEP_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } }) // re-enqueue lost/stale webhook deliveries
  await queue.raw.upsertJobScheduler(RECURRENCE_JOB, { every: 15 * 60_000 }, { name: RECURRENCE_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } }) // recurring task instances (T4.4); idempotent per (series, local date)
  await queue.raw.upsertJobScheduler(ARCHIVE_PURGE_JOB, { every: 60 * 60_000 }, { name: ARCHIVE_PURGE_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } }) // purge tasks archived 30+ days ago (T4.5); idempotent, safe with two runs
  await queue.raw.upsertJobScheduler(DEADLINE_JOB, { every: 5 * 60_000 }, { name: DEADLINE_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } }) // shift-end prompt and missing-report alerts (T5.4); exactly once per (member, shift, day, kind) via the ledger, safe with two workers
  await queue.raw.upsertJobScheduler(EXPORT_SWEEP_JOB, { every: 10 * 60_000 }, { name: EXPORT_SWEEP_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } }) // report exports (T5.5): re-enqueue lost exports, expire files after 7 days; safe with two workers
  deps.logger.info("worker started")
  return {
    async close() {
      await worker.close()
      await new Promise((r) => (metricsServer ? metricsServer.close(r) : r(undefined)))
      await queue.close?.()
      await deps.queue.close?.()
      await deps.db.$client.end()
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startWorkerProcess().then((w) => {
    process.once("SIGTERM", () => void w.close().then(() => process.exit(0)))
    process.once("SIGINT", () => void w.close().then(() => process.exit(0)))
  })
}
