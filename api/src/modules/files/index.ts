import { registerJob } from "../../core/queue/queue"
import { DELETE_OBJECT_JOB, deleteObject, SCAN_JOB, scanFile } from "./service"

export { fileRoutes } from "./routes"
export { ALLOWED_MIMES, normalizeMime } from "./mime"
export { TASK_VIDEO_MIMES, TASK_VOICE_MIMES } from "./mime"
export { completeUpload, createUpload, DELETE_OBJECT_JOB, DOWNLOAD_TTL_SEC, expireFile, taskFileDownloadUrl, UPLOAD_TTL_SEC, type UploadPolicy } from "./service"

/** Registers the `file.scan` and `file.delete-object` job handlers (worker.ts, tests). Safe to call again. */
export function registerFiles(): void {
  registerJob(SCAN_JOB, scanFile)
  registerJob(DELETE_OBJECT_JOB, deleteObject)
}
