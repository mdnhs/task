import { registerJob } from "../../core/queue/queue"
import { REFRESH_JOB, refreshJob } from "./service"

export { integrationRoutes } from "./routes"
export { getAccessToken, REFRESH_JOB, REFRESH_SKEW_MS, STATE_TTL_MS } from "./service"

/** Registers the `integration.refresh` job handler (worker.ts, tests). Safe to call again. */
export function registerIntegrations(): void {
  registerJob(REFRESH_JOB, refreshJob)
}
