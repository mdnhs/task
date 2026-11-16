import { registerJob } from "../../core/queue/queue"
import { registerCoreDsrHandlers } from "./core-handlers"
import { ERASE_JOB, EXPIRE_JOB, EXPORT_JOB, expireExport, runErase, runExport } from "./service"

export { gdprRoutes } from "./routes"
export { registerDsrHandler, type DsrHandler } from "./registry"
export { registerCoreDsrHandlers, scrubPayload, ERASED } from "./core-handlers"
export { DUE_DAYS, EXPORT_TTL_MS } from "./service"

/** Registers the core DSR handlers and the `dsr.export`, `dsr.erase`, `dsr.export-expire` jobs (worker.ts, tests). Safe to call again. */
export function registerGdpr(): void {
  registerCoreDsrHandlers()
  registerJob(EXPORT_JOB, runExport)
  registerJob(ERASE_JOB, runErase)
  registerJob(EXPIRE_JOB, expireExport)
}
