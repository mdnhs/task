import { registerDsrHandler } from "../gdpr/registry"
import { tasksDsrHandler } from "./dsr"

export { taskRoutes } from "./routes"
export { collabRoutes } from "./collab-routes"
export { planningRoutes } from "./planning-routes"
export { indexTask, registerTaskSearchIndexers, taskSearchScope } from "./search"
export { applyTaskUpdate, buildListQuery, completeTask, createTask, listTasks, normaliseLabels, patchTask, setAssignees, changeStatus } from "./service"
export { mutate, read1 } from "./run"
export { checkRule, checkTeam } from "./service"
export { writeHistory } from "./history"
export { publishTaskEvent } from "./events"
export { notifyTask, type TaskEnv } from "./notify"
export { allAssignees, assigneesOf } from "./repo"
export { wallOf } from "./time"
export { decodeCursor, encodeCursor } from "./cursor"
export { canManage, getTask, inScope, loadTaskCtx, taskScopeWhere, TaskNotFound, type TaskCtx, type TaskRow } from "./scope"
export { tasksDsrHandler } from "./dsr"

/** Registers the tasks DSR handler (worker.ts, tests). Safe to call again. */
export function registerTasks(): void {
  registerDsrHandler("tasks", tasksDsrHandler)
}
