import { registerJob } from "../../core/queue/queue"
import { registerDsrHandler } from "../gdpr/registry"
import { ARCHIVE_PURGE_JOB, runArchivePurge } from "./archive"
import { tasksDsrHandler } from "./dsr"
import { RECURRENCE_JOB, runRecurrence } from "./recurrence"

export { archiveRoutes, taskViewRoutes } from "./archive-routes"
export { ARCHIVE_PURGE_JOB, runArchivePurge } from "./archive"
export { taskCards, type TaskCard } from "./views"
export { taskRoutes } from "./routes"
export { collabRoutes } from "./collab-routes"
export { planningRoutes } from "./planning-routes"
export { indexTask, registerTaskSearchIndexers, taskSearchScope } from "./search"
export { applyTaskUpdate, buildListQuery, completeTask, createTask, listTasks, normaliseLabels, patchTask, setAssignees, changeStatus } from "./service"
export { mutate, read1 } from "./run"
export { checkAssignees, checkRule, checkTeam } from "./service"
export { writeHistory } from "./history"
export { publishTaskEvent } from "./events"
export { notifyTask, type TaskEnv } from "./notify"
export { allAssignees, assigneesOf } from "./repo"
export { wallOf } from "./time"
export { decodeCursor, encodeCursor } from "./cursor"
export { canManage, getTask, inScope, loadTaskCtx, taskScopeWhere, TaskNotFound, type TaskCtx, type TaskRow } from "./scope"
export { tasksDsrHandler } from "./dsr"
export { RECURRENCE_JOB, runRecurrence, setRepeat } from "./recurrence"

/** Registers the tasks DSR handler and the `tasks.recurrence` and `tasks.archive-purge` jobs (worker.ts, tests). Safe to call again. */
export function registerTasks(): void {
  registerDsrHandler("tasks", tasksDsrHandler)
  registerJob(RECURRENCE_JOB, runRecurrence)
  registerJob(ARCHIVE_PURGE_JOB, runArchivePurge)
}
