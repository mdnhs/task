import { registerJob } from "../../core/queue/queue"
import { registerCoreDsrHandlers } from "./core-handlers"
import { ERASE_JOB, EXPIRE_JOB, EXPORT_JOB, SWEEP_JOB, expireExport, runErase, runExport, sweepRequests } from "./service"

export { gdprRoutes } from "./routes"
export { registerDsrHandler, type DsrHandler } from "./registry"
export { registerCoreDsrHandlers, scrubPayload, ERASED } from "./core-handlers"
export { DUE_DAYS, EXPORT_TTL_MS, SWEEP_JOB, resolveByPlatform, type DataRequestDto } from "./service"

/** Registers the core DSR handlers and the `dsr.export`, `dsr.erase`, `dsr.export-expire`, `dsr.sweep` jobs (worker.ts, tests). Safe to call again. */
export function registerGdpr(): void {
  registerCoreDsrHandlers()
  registerJob(EXPORT_JOB, runExport)
  registerJob(ERASE_JOB, runErase)
  registerJob(EXPIRE_JOB, expireExport)
  registerJob(SWEEP_JOB, sweepRequests)
}
