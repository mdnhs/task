import { pathToFileURL } from "node:url"
import { relayOnce } from "./core/events"
import { makeBullQueue, startWorker } from "./core/queue/bull-queue"
import { registerJob } from "./core/queue/queue"
import { registerFiles } from "./modules/files"
import { registerIntegrations } from "./modules/integrations"
import { registerNotifications } from "./modules/notifications"
import { registerSearchIndexers } from "./modules/search"
import { parseEnv, type Env } from "./env"
import { makeDeps } from "./server"

/** Background worker process: BullMQ job handlers plus the 1 s `events.relay` repeatable job. */
export async function startWorkerProcess(env: Env = parseEnv(process.env)) {
  const deps = makeDeps(env)
  registerNotifications() // notification.send job + member.joined subscriber
  registerSearchIndexers() // search index: members, teams, files
  registerFiles() // file.scan + file.delete-object jobs
  registerIntegrations() // integration.refresh job (token refresh is otherwise lazy, see getAccessToken)
  registerJob("events.relay", async (_data, d) => {
    await relayOnce(d)
  })
  const worker = startWorker(deps, env.REDIS_URL)
  const queue = makeBullQueue(env.REDIS_URL)
  await queue.raw.upsertJobScheduler("events.relay", { every: 1000 }, { name: "events.relay", opts: { removeOnComplete: true, removeOnFail: 100 } })
  deps.logger.info("worker started")
  return {
    async close() {
      await worker.close()
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
