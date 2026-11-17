import { createRoute } from "@hono/zod-openapi"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenantAfterCommit } from "../notifications"
import {
  addChecklistItem, addComment, ChecklistBody, ChecklistItemSchema, ChecklistPatchBody, CommentBody, CommentList, CommentParams, CommentQuery, CommentSchema, createSubtask,
  deleteChecklistItem, deleteComment, ItemParams, listComments, patchChecklistItem, SubtaskBody,
} from "./collab"
import { IdParam, TaskDtoSchema } from "./dto"
import { nextRefNo } from "./repo"
import { mutate, read1 } from "./run"
import { loadTaskCtx } from "./scope"
import { completeTaskUpload, FileParams, taskFileDownload, taskUploadIntent, TaskFileSchema, UploadBody, UploadIntent } from "./uploads"

const read = [requireTenant, requireModule("M1"), requirePermission("tasks", "read")]
const write = [requireTenant, requireModule("M1"), requirePermission("tasks", "write")]
const content = <S extends object>(schema: S) => ({ "application/json": { schema } })
const reqBody = <S extends object>(schema: S) => ({ content: content(schema), required: true as const })

const checklistAdd = createRoute({
  method: "post", path: "/v1/tasks/{id}/checklist", middleware: write, request: { params: IdParam, body: reqBody(ChecklistBody) },
  responses: { 201: { description: "The new item (at most 50 per task; the task version does not change). 403 forbidden; 404 task_not_found; 422 checklist_limit", content: content(ChecklistItemSchema) } },
})
const checklistPatch = createRoute({
  method: "patch", path: "/v1/tasks/{id}/checklist/{itemId}", middleware: write, request: { params: ItemParams, body: reqBody(ChecklistPatchBody) },
  responses: { 200: { description: "The item. `done` is absolute (assignee, manager or creator); `text` is for the creator or a manager. 403 forbidden; 404 task_not_found | checklist_item_not_found", content: content(ChecklistItemSchema) } },
})
const checklistDelete = createRoute({
  method: "delete", path: "/v1/tasks/{id}/checklist/{itemId}", middleware: write, request: { params: ItemParams },
  responses: { 204: { description: "Removed (creator or manager). 404 task_not_found | checklist_item_not_found" } },
})
const subtaskAdd = createRoute({
  method: "post", path: "/v1/tasks/{id}/subtasks", middleware: write, request: { params: IdParam, body: reqBody(SubtaskBody) },
  responses: { 201: { description: "The child task: same team, project and due date, no evidence. 403 forbidden; 404 task_not_found; 422 subtask_depth", content: content(TaskDtoSchema) } },
})
const commentList = createRoute({
  method: "get", path: "/v1/tasks/{id}/comments", middleware: read, request: { params: IdParam, query: CommentQuery },
  responses: { 200: { description: "Comments oldest first; pass nextCursor back as cursor. Drive links are withheld off the company PC. 400 invalid_cursor; 404 task_not_found", content: content(CommentList) } },
})
const commentAdd = createRoute({
  method: "post", path: "/v1/tasks/{id}/comments", middleware: write, request: { params: IdParam, body: reqBody(CommentBody) },
  responses: { 201: { description: "The comment. Mentioned members who can see the task are notified; the answer is the same for everyone else. 404 task_not_found; 422 invalid_attachment", content: content(CommentSchema) } },
})
const commentDelete = createRoute({
  method: "delete", path: "/v1/tasks/{id}/comments/{commentId}", middleware: write, request: { params: CommentParams },
  responses: { 204: { description: "Soft-deleted (its author, or a manager of the task). 403 forbidden; 404 task_not_found | comment_not_found" } },
})
const uploadIntent = createRoute({
  method: "post", path: "/v1/tasks/{id}/uploads", middleware: write, request: { params: IdParam, body: reqBody(UploadBody) },
  responses: { 201: { description: "A presigned PUT (300 s), same as /v1/files/uploads, but needs M1 and access to the task, not M4 and files:write. 403 forbidden; 404 task_not_found; 422 mime_not_allowed | file_too_large | invalid_name", content: content(UploadIntent) } },
})
const uploadComplete = createRoute({
  method: "post", path: "/v1/tasks/{id}/uploads/{fileId}/complete", middleware: write, request: { params: FileParams },
  responses: { 200: { description: "Upload confirmed; the malware scan is queued. Idempotent. 404 task_not_found | file_not_found; 409 upload_missing; 422 upload_mismatch", content: content(TaskFileSchema) } },
})
const fileDownload = createRoute({
  method: "get", path: "/v1/tasks/{id}/files/{fileId}/download", middleware: read, request: { params: FileParams },
  responses: { 302: { description: "Redirect to a 60 s presigned GET. 404 task_not_found | file_not_found; 409 file_not_ready; 410 file_infected" } },
})

export const collabRoutes = newRouter()
  .openapi(checklistAdd, async (c) => c.json(await mutate(c, (tx, _env, ctx) => addChecklistItem(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 201))
  .openapi(checklistPatch, async (c) => {
    const { id, itemId } = c.req.valid("param")
    return c.json(await mutate(c, (tx, _env, ctx) => patchChecklistItem(tx, ctx, id, itemId, c.req.valid("json"))), 200)
  })
  .openapi(checklistDelete, async (c) => {
    const { id, itemId } = c.req.valid("param")
    await mutate(c, (tx, _env, ctx) => deleteChecklistItem(tx, ctx, id, itemId))
    return c.body(null, 204)
  })
  .openapi(subtaskAdd, async (c) => {
    const deps = c.get("deps")
    const { id } = c.req.valid("param")
    const input = c.req.valid("json")
    // lock order as in create: the ref counter row first, then the actor lock, then the task rows
    const out = await withTenantAfterCommit(deps, c.get("tenant")!.id, async (tx, enqueue) => {
      const refNo = await nextRefNo(tx, c.get("tenant")!.id)
      return createSubtask(tx, { deps, enqueue }, await loadTaskCtx(c, tx, "write"), id, refNo, input)
    })
    return c.json(out, 201)
  })
  .openapi(commentList, async (c) => c.json(await read1(c, (tx, ctx) => listComments(tx, ctx, c.req.valid("param").id, c.req.valid("query"))), 200))
  .openapi(commentAdd, async (c) => c.json(await mutate(c, (tx, env, ctx) => addComment(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 201))
  .openapi(commentDelete, async (c) => {
    const { id, commentId } = c.req.valid("param")
    await mutate(c, (tx, _env, ctx) => deleteComment(tx, ctx, id, commentId))
    return c.body(null, 204)
  })
  .openapi(uploadIntent, async (c) => c.json(await taskUploadIntent(c, c.req.valid("param").id, c.req.valid("json")), 201))
  .openapi(uploadComplete, async (c) => c.json(await completeTaskUpload(c, c.req.valid("param").id, c.req.valid("param").fileId), 200))
  .openapi(fileDownload, async (c) => {
    const url = await taskFileDownload(c, c.req.valid("param").id, c.req.valid("param").fileId)
    c.header("Cache-Control", "no-store")
    return c.redirect(url, 302)
  })
