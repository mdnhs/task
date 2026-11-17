import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { Forbidden } from "../../core/errors"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { taskFileDownloadUrl } from "../files"
import { IdParam, mutate, read1, TaskDtoSchema } from "../tasks"
import { BatchBody, BatchResult, EvidenceBody, EvidenceItem, EvidenceParams, GalleryList, GalleryQuery, RejectBody, RuleBody, VerifyBody } from "./dto"
import { gallery } from "./gallery"
import { decide, verifyBatch } from "./review"
import { addEvidence, deleteEvidence, evidenceTarget, setEvidenceRule } from "./service"

const read = [requireTenant, requireModule("M1"), requirePermission("tasks", "read")]
const write = [requireTenant, requireModule("M1"), requirePermission("tasks", "write")]
const content = <S extends object>(schema: S) => ({ "application/json": { schema } })
const reqBody = <S extends object>(schema: S) => ({ content: content(schema), required: true as const })

/** Verification is a person's attestation: no API key may verify or reject, whatever its scopes (ruling D8). Refused BEFORE the task is even looked up. */
const humanOnly = (c: Context<AppEnv>) => {
  if (c.get("apiKey")) throw Forbidden("human_required")
}
/** The device of THIS request as a capture fact (ruling D19): a registered device's id, never the unregistered browser, never a client claim. */
const deviceIdOf = (c: Context<AppEnv>): string | null => {
  const d = c.get("device")
  return d && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.id) ? d.id : null
}

const ruleR = createRoute({
  method: "put", path: "/v1/tasks/{id}/evidence-rule", middleware: write, request: { params: IdParam, body: reqBody(RuleBody) },
  responses: { 200: { description: "The task with its new evidence rule (the creator or a manager; locked once submitted, completed or cancelled). 403 forbidden; 404 task_not_found; 409 version_conflict | evidence_locked | task_archived; 422 invalid_evidence_rule | invalid_reviewer (a named reviewer must be an active member with tasks:write)", content: content(TaskDtoSchema) } },
})
const addR = createRoute({
  method: "post", path: "/v1/tasks/{id}/evidence", middleware: write, request: { params: IdParam, body: reqBody(EvidenceBody) },
  responses: { 201: { description: "The item (round of the task; pending review; a file item counts only once its file is clean). 403 forbidden | device_policy (Drive off the company PC); 404 task_not_found | file_not_found; 409 evidence_locked | file_infected; 422 evidence_type_not_allowed | invalid_evidence | invalid_captured_at; 400 for an unknown field such as location", content: content(EvidenceItem) } },
})
const deleteR = createRoute({
  method: "delete", path: "/v1/tasks/{id}/evidence/{evidenceId}", middleware: write, request: { params: EvidenceParams },
  responses: { 204: { description: "Removed (its uploader only, while unlocked); its file is deleted. 403 forbidden; 404 task_not_found | evidence_not_found; 409 evidence_locked" } },
})
const downloadR = createRoute({
  method: "get", path: "/v1/tasks/{id}/evidence/{evidenceId}/download", middleware: read, request: { params: EvidenceParams },
  responses: { 302: { description: "Redirect to a 60 s presigned GET (file items, after the scan gate) or to the Drive link (on the company PC). 404 task_not_found | evidence_not_found (also a Drive item off the company PC, a note or a checklist); 409 file_not_ready; 410 file_infected" } },
})
const verifyR = createRoute({
  method: "post", path: "/v1/tasks/{id}/verify", middleware: write, request: { params: IdParam, body: reqBody(VerifyBody) },
  responses: { 200: { description: "The named (default: every pending) items are accepted; when none is left waiting the task is Completed. Audited. 403 human_required (API key) | self_verification (an assignee, or the uploader of a targeted item) | not_a_reviewer; 404 task_not_found | evidence_not_found; 409 version_conflict | invalid_transition (not submitted, or an item already reviewed) | evidence_not_ready | task_archived", content: content(TaskDtoSchema) } },
})
const rejectR = createRoute({
  method: "post", path: "/v1/tasks/{id}/reject", middleware: write, request: { params: IdParam, body: reqBody(RejectBody) },
  responses: { 200: { description: "The items are rejected (they stay as earlier versions), the task is Changes Requested in the next round, the reason becomes a comment and the assignees are told. Audited. Same independence rules and errors as verify", content: content(TaskDtoSchema) } },
})
const galleryR = createRoute({
  method: "get", path: "/v1/evidence", middleware: read, request: { query: GalleryQuery },
  responses: { 200: { description: "Evidence items of live tasks in the caller's scope, newest first (awaiting = pending on a submitted task with a clean file); pass nextCursor back as cursor. Drive links are withheld off the company PC. 400 invalid_cursor", content: content(GalleryList) } },
})
const batchR = createRoute({
  method: "post", path: "/v1/evidence/verify-batch", middleware: write, request: { body: reqBody(BatchBody) },
  responses: { 200: { description: "One result per item, in request order: verified, or failed with the code verify would have given. Each item is its own savepoint, so a refused one never rolls back the others. 403 human_required (API key)", content: content(BatchResult) } },
})

export const evidenceRoutes = newRouter()
  .openapi(ruleR, async (c) => c.json(await mutate(c, (tx, env, ctx) => setEvidenceRule(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(addR, async (c) => {
    const deviceId = deviceIdOf(c)
    return c.json(await mutate(c, (tx, env, ctx) => addEvidence(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"), deviceId)), 201)
  })
  .openapi(deleteR, async (c) => {
    const { id, evidenceId } = c.req.valid("param")
    await mutate(c, (tx, env, ctx) => deleteEvidence(tx, env, ctx, id, evidenceId))
    return c.body(null, 204)
  })
  .openapi(downloadR, async (c) => {
    const { id, evidenceId } = c.req.valid("param")
    const target = await read1(c, (tx, ctx) => evidenceTarget(tx, ctx, id, evidenceId))
    const url = "url" in target ? target.url : await taskFileDownloadUrl(c.get("deps"), c.get("tenant")!.id, target.fileId) // the scan gate lives there
    c.header("Cache-Control", "no-store")
    return c.redirect(url, 302)
  })
  .openapi(verifyR, async (c) => {
    humanOnly(c)
    return c.json(await mutate(c, (tx, env, ctx) => decide(tx, env, ctx, c.req.valid("param").id, "verify", c.req.valid("json"))), 200)
  })
  .openapi(rejectR, async (c) => {
    humanOnly(c)
    return c.json(await mutate(c, (tx, env, ctx) => decide(tx, env, ctx, c.req.valid("param").id, "reject", c.req.valid("json"))), 200)
  })
  .openapi(galleryR, async (c) => c.json(await read1(c, (tx, ctx) => gallery(tx, ctx, c.req.valid("query"))), 200))
  .openapi(batchR, async (c) => {
    humanOnly(c)
    return c.json({ items: await mutate(c, (tx, env, ctx) => verifyBatch(tx, env, ctx, c.req.valid("json").items)) }, 200)
  })
