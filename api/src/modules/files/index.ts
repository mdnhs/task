import { registerJob } from "../../core/queue/queue"
import { DELETE_OBJECT_JOB, deleteObject, SCAN_JOB, scanFile } from "./service"

export { fileRoutes } from "./routes"
export { ALLOWED_MIMES, normalizeMime } from "./mime"
export { DOWNLOAD_TTL_SEC, UPLOAD_TTL_SEC } from "./service"

/** Registers the `file.scan` and `file.delete-object` job handlers (worker.ts, tests). Safe to call again. */
export function registerFiles(): void {
  registerJob(SCAN_JOB, scanFile)
  registerJob(DELETE_OBJECT_JOB, deleteObject)
}
