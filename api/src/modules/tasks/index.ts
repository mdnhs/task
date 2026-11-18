import { registerJob } from "../../core/queue/queue"
import { registerDsrHandler } from "../gdpr/registry"
import { ARCHIVE_PURGE_JOB, runArchivePurge } from "./archive"
import { tasksDsrHandler } from "./dsr"
import { registerEvidenceSubscriber } from "./evidence"
import { RECURRENCE_JOB, runRecurrence } from "./recurrence"

export { archiveRoutes, taskViewRoutes } from "./archive-routes"
export { ARCHIVE_PURGE_JOB, runArchivePurge } from "./archive"
export { taskCards, type TaskCard } from "./views"
export { taskRoutes } from "./routes"
export { collabRoutes } from "./collab-routes"
export { voiceRoutes } from "./voice-routes"
export { playsQuery } from "./voice"
export { TASK_PURGE_LOCK_NS, voiceFileStillReferenced } from "./voice-refs"
export { planningRoutes } from "./planning-routes"
export { indexTask, registerTaskSearchIndexers, taskSearchScope } from "./search"
export { applyTaskUpdate, buildListQuery, listConditions, OPEN_STATUSES, completeTask, createTask, listTasks, normaliseLabels, patchTask, setAssignees, changeStatus } from "./service"
export { mutate, read1 } from "./run"
export { checkAssignees, checkRule, checkTeam, lockedTask, staleVersion, taskDetailDto, unprocessable } from "./service"
export { applyCompletion, AUTO, counts, evidenceDtos, loadEvidence, rejectItems, SCAN_REASON, SCANNER, settleCompletion, stateItems, type EvidenceDto, type EvidenceRow, type EvidenceView } from "./evidence"
export { namesOf } from "./history"
export { IdParam, TaskDtoSchema, type TaskDto } from "./dto"
export { evidenceFilter } from "./evidence"
export { writeHistory } from "./history"
export { publishTaskEvent, type TaskEvent } from "./events"
export { notifyTask, type TaskEnv } from "./notify"
export { allAssignees, assigneesOf } from "./repo"
export { wallOf } from "./time"
export { decodeCursor, encodeCursor } from "../../core/cursor"
export { canManage, getTask, inScope, loadTaskCtx, taskCtxOf, taskScopeWhere, TaskNotFound, type TaskCtx, type TaskRow } from "./scope"
export { tasksDsrHandler } from "./dsr"
export { listTasksForPerson, shiftTasksQuery, type ShiftTaskRow } from "./shift-tasks"
export { RECURRENCE_JOB, runRecurrence, setRepeat } from "./recurrence"

/** Registers the tasks DSR handler, the `tasks.recurrence` and `tasks.archive-purge` jobs and the `file.scanned` evidence subscriber (worker.ts, tests). Safe to call again. */
export function registerTasks(): void {
  registerDsrHandler("tasks", tasksDsrHandler)
  registerJob(RECURRENCE_JOB, runRecurrence)
  registerJob(ARCHIVE_PURGE_JOB, runArchivePurge)
  registerEvidenceSubscriber() // file.scanned: an infected file auto-rejects its evidence item (ruling D10)
}
