import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { withTenantAfterCommit } from "../notifications"
import { AssigneesBody, CompleteBody, CreateBody, HistoryList, HistoryQuery, IdParam, ListQuery, PatchBody, StatusBody, TaskDtoSchema, TaskList } from "./dto"
import { nextRefNo } from "./repo"
import { getTask, loadTaskCtx, type TaskCtx } from "./scope"
import { changeStatus, completeTask, createTask, getTaskDetail, listHistory, listTasks, patchTask, setAssignees } from "./service"
import type { TaskEnv } from "./notify"

const json = (schema: typeof TaskDtoSchema | typeof TaskList | typeof HistoryList, description: string) => ({ description, content: { "application/json": { schema } } })
const body = <T extends typeof CreateBody | typeof PatchBody | typeof AssigneesBody | typeof StatusBody | typeof CompleteBody>(schema: T) => ({ content: { "application/json": { schema } }, required: true as const })

const listR = createRoute({
  method: "get", path: "/v1/tasks", middleware: [requireTenant, requireModule("M1"), requirePermission("tasks", "read")] as const, request: { query: ListQuery },
  responses: { 200: json(TaskList, "Tasks in the caller's scope, soonest due first; pass nextCursor back as cursor. 400 invalid_cursor") },
})
const createR = createRoute({
  method: "post", path: "/v1/tasks", middleware: [requireTenant, requireModule("M1"), requirePermission("tasks", "write")] as const, request: { body: body(CreateBody) },
  responses: { 201: json(TaskDtoSchema, "The new task. 403 cannot_assign_others; 422 invalid_dates | invalid_assignee | invalid_team | invalid_labels | invalid_evidence_rule | invalid_reviewer") },
})
const getR = createRoute({
  method: "get", path: "/v1/tasks/{id}", middleware: [requireTenant, requireModule("M1"), requirePermission("tasks", "read")] as const, request: { params: IdParam },
  responses: { 200: json(TaskDtoSchema, "The task with its last 50 history lines. 404 task_not_found (also when it is outside the caller's scope)") },
})
const patchR = createRoute({
  method: "patch", path: "/v1/tasks/{id}", middleware: [requireTenant, requireModule("M1"), requirePermission("tasks", "write")] as const, request: { params: IdParam, body: body(PatchBody) },
  responses: { 200: json(TaskDtoSchema, "The updated task. 403 dates_manager_only | forbidden; 409 version_conflict; 422 invalid_dates | invalid_team | invalid_labels") },
})
const assigneesR = createRoute({
  method: "put", path: "/v1/tasks/{id}/assignees", middleware: [requireTenant, requireModule("M1"), requirePermission("tasks", "write")] as const, request: { params: IdParam, body: body(AssigneesBody) },
  responses: { 200: json(TaskDtoSchema, "The task with its new assignees (managers only). 403 forbidden; 409 version_conflict; 422 invalid_assignee") },
})
const statusR = createRoute({
  method: "post", path: "/v1/tasks/{id}/status", middleware: [requireTenant, requireModule("M1"), requirePermission("tasks", "write")] as const, request: { params: IdParam, body: body(StatusBody) },
  responses: { 200: json(TaskDtoSchema, "The task after the move. 403 forbidden; 409 version_conflict; 422 invalid_transition | evidence_required") },
})
const completeR = createRoute({
  method: "post", path: "/v1/tasks/{id}/complete", middleware: [requireTenant, requireModule("M1"), requirePermission("tasks", "write")] as const, request: { params: IdParam, body: body(CompleteBody) },
  responses: { 200: json(TaskDtoSchema, "Completed, or Awaiting verification when a reviewer must check. 409 version_conflict; 422 invalid_transition | evidence_required") },
})
const historyR = createRoute({
  method: "get", path: "/v1/tasks/{id}/history", middleware: [requireTenant, requireModule("M1"), requirePermission("tasks", "read")] as const, request: { params: IdParam, query: HistoryQuery },
  responses: { 200: json(HistoryList, "Field history newest first with old and new values in tenant time; pass nextCursor back as cursor. 400 invalid_cursor") },
})

/** A read: one tenant tx, the caller's context from the request (role as loaded by the guard). */
function read1<T>(c: Context<AppEnv>, fn: (tx: TenantTx, ctx: TaskCtx) => Promise<T>): Promise<T> {
  return withTenant(c.get("deps").db, c.get("tenant")!.id, async (tx) => fn(tx, await loadTaskCtx(c, tx)))
}

/** A mutation: the actor lock (R25) first, then the work; notification jobs are enqueued only after the tx commits. */
function mutate<T>(c: Context<AppEnv>, fn: (tx: TenantTx, env: TaskEnv, ctx: TaskCtx) => Promise<T>): Promise<T> {
  const deps = c.get("deps")
  return withTenantAfterCommit(deps, c.get("tenant")!.id, async (tx, enqueue) => fn(tx, { deps, enqueue }, await loadTaskCtx(c, tx, "write")))
}

export const taskRoutes = newRouter()
  .openapi(listR, async (c) => c.json(await read1(c, (tx, ctx) => listTasks(tx, ctx, c.req.valid("query"))), 200))
  .openapi(createR, async (c) => {
    const deps = c.get("deps")
    const input = c.req.valid("json")
    // lock order: the ref counter row first, then the actor lock, then the writes (the counter serialises creates of one tenant)
    const out = await withTenantAfterCommit(deps, c.get("tenant")!.id, async (tx, enqueue) => {
      const refNo = await nextRefNo(tx, c.get("tenant")!.id)
      return createTask(tx, { deps, enqueue }, await loadTaskCtx(c, tx, "write"), refNo, input)
    })
    return c.json(out, 201)
  })
  .openapi(getR, async (c) => c.json(await read1(c, (tx, ctx) => getTaskDetail(tx, ctx, c.req.valid("param").id)), 200))
  .openapi(patchR, async (c) => c.json(await mutate(c, (tx, env, ctx) => patchTask(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(assigneesR, async (c) => c.json(await mutate(c, (tx, env, ctx) => setAssignees(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(statusR, async (c) => c.json(await mutate(c, (tx, env, ctx) => changeStatus(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(completeR, async (c) => c.json(await mutate(c, (tx, env, ctx) => completeTask(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(historyR, async (c) =>
    c.json(
      await read1(c, async (tx, ctx) => {
        const id = c.req.valid("param").id
        await getTask(tx, ctx, id) // the same 404 (missing, other tenant, out of scope) before any history is read
        return listHistory(tx, ctx, id, c.req.valid("query"))
      }),
      200,
    ),
  )
