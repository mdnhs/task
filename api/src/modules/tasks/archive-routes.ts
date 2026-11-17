import { createRoute } from "@hono/zod-openapi"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { archiveTask, ArchiveBody, purgeTask, restoreTask, RestoreBody } from "./archive"
import { IdParam, TaskDtoSchema } from "./dto"
import { mutate, read1 } from "./run"
import { archiveListView, ArchiveListQuery, ArchiveListSchema, boardView, BoardQuery, BoardSchema, calendarView, CalendarQuery, CalendarSchema } from "./views"

const read = [requireTenant, requireModule("M1"), requirePermission("tasks", "read")]
const write = [requireTenant, requireModule("M1"), requirePermission("tasks", "write")]
const content = <S extends object>(schema: S) => ({ "application/json": { schema } })
const reqBody = <S extends object>(schema: S) => ({ content: content(schema), required: true as const })

const archiveR = createRoute({
  method: "post", path: "/v1/tasks/{id}/archive", middleware: write, request: { params: IdParam, body: reqBody(ArchiveBody) },
  responses: { 200: { description: "Archived with its open subtasks (one batch); out of every list, board, calendar and search until restored (30 days). Managers only. 403 forbidden; 404 task_not_found; 409 version_conflict | task_archived", content: content(TaskDtoSchema) } },
})
const restoreR = createRoute({
  method: "post", path: "/v1/tasks/{id}/restore", middleware: write, request: { params: IdParam, body: reqBody(RestoreBody) },
  responses: { 200: { description: "Restored with the rest of its archive batch. Managers only. 403 forbidden; 404 task_not_found; 409 task_not_archived; 410 archive_expired (after 30 days)", content: content(TaskDtoSchema) } },
})
const purgeR = createRoute({
  method: "delete", path: "/v1/tasks/{id}", middleware: [requireTenant, requireModule("M1"), requirePermission("settings", "write")], request: { params: IdParam },
  responses: { 204: { description: "Permanently deleted with its children, dependency edges and files (audited). Tenant admins only, a person (never an API key), and only for an archived task. 403 forbidden | human_required; 404 task_not_found; 409 task_not_archived" } },
})
const archiveListR = createRoute({
  method: "get", path: "/v1/tasks/archive", middleware: read, request: { query: ArchiveListQuery },
  responses: { 200: { description: "Archived tasks in the caller's scope, newest archive first, with the days left to restore; pass nextCursor back as cursor. Managers only. 400 invalid_cursor; 403 forbidden", content: content(ArchiveListSchema) } },
})
const boardR = createRoute({
  method: "get", path: "/v1/tasks/board", middleware: read, request: { query: BoardQuery },
  responses: { 200: { description: "One column per status (STATUS_ORDER) with its count and up to 50 cards, soonest due first; page one column with column + cursor. 400 invalid_cursor", content: content(BoardSchema) } },
})
const calendarR = createRoute({
  method: "get", path: "/v1/tasks/calendar", middleware: read, request: { query: CalendarQuery },
  responses: { 200: { description: "Cards grouped by the tenant-local due date, every day of the range present (at most 42 days, 1000 cards). 422 invalid_range", content: content(CalendarSchema) } },
})

/** Static task paths: registered BEFORE `/v1/tasks/{id}` (app.ts), so "archive", "board" and "calendar" are never read as an id. */
export const taskViewRoutes = newRouter()
  .openapi(archiveListR, async (c) => c.json(await read1(c, (tx, ctx) => archiveListView(tx, ctx, c.req.valid("query"))), 200))
  .openapi(boardR, async (c) => c.json(await read1(c, (tx, ctx) => boardView(tx, ctx, c.req.valid("query"))), 200))
  .openapi(calendarR, async (c) => c.json(await read1(c, (tx, ctx) => calendarView(tx, ctx, c.req.valid("query"))), 200))

export const archiveRoutes = newRouter()
  .openapi(archiveR, async (c) => c.json(await mutate(c, (tx, env, ctx) => archiveTask(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(restoreR, async (c) => c.json(await mutate(c, (tx, env, ctx) => restoreTask(tx, env, ctx, c.req.valid("param").id)), 200))
  .openapi(purgeR, async (c) => {
    await purgeTask(c, c.req.valid("param").id)
    return c.body(null, 204)
  })
