import { registerDsrHandler } from "../gdpr/registry"
import { tasksDsrHandler } from "./dsr"

export { taskRoutes } from "./routes"
export { applyTaskUpdate, buildListQuery, completeTask, createTask, listTasks, normaliseLabels, patchTask, setAssignees, changeStatus } from "./service"
export { canManage, getTask, inScope, loadTaskCtx, taskScopeWhere, TaskNotFound, type TaskCtx, type TaskRow } from "./scope"
export { tasksDsrHandler } from "./dsr"

/** Registers the tasks DSR handler (worker.ts, tests). Safe to call again. */
export function registerTasks(): void {
  registerDsrHandler("tasks", tasksDsrHandler)
}
