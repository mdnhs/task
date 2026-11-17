import { createRoute } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { Forbidden } from "../../core/errors"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { withTenantAfterCommit, type Enqueue } from "../notifications"
import type { Deps } from "../../deps"
import { currentItem, openReport, saveDraft } from "./draft"
import { CurrentOut, DraftBody, FileParams, IdParam, OpenBody, ReportFileSchema, ReportSchema, SubmitBody, UploadBody, UploadIntent, VersionsOut } from "./dto"
import { getReport, loadReportCtx, type ReportCtx } from "./scope"
import { submitReport } from "./submit"
import { completeReportUpload, reportFileDownload, reportUploadIntent } from "./uploads"
import { reportDtos, versionDtos } from "./view"

const guard = (need: "read" | "write") => [requireTenant, requireModule("M1"), requirePermission("reports", need)]
const json = <S extends object>(schema: S, description: string) => ({ description, content: { "application/json": { schema } } })
const body = <S extends object>(schema: S) => ({ content: { "application/json": { schema } }, required: true as const })

/** A read: one tenant tx, the caller's context from the request (role as loaded by the guard). */
const read = <T>(c: Context<AppEnv>, fn: (tx: TenantTx, ctx: ReportCtx) => Promise<T>): Promise<T> => withTenant(c.get("deps").db, c.get("tenant")!.id, async (tx) => fn(tx, await loadReportCtx(c, tx)))

/**
 * A mutation: the actor lock (R25, role re-read FOR SHARE) first, then the work; notification and file-removal jobs are enqueued only after the tx commits.
 * Deadlocks and serialisation failures are 409 `retry` (app.ts).
 */
const write = <T>(c: Context<AppEnv>, fn: (tx: TenantTx, env: { deps: Deps; enqueue: Enqueue }, ctx: ReportCtx) => Promise<T>): Promise<T> => {
  const deps = c.get("deps")
  return withTenantAfterCommit(deps, c.get("tenant")!.id, async (tx, enqueue) => fn(tx, { deps, enqueue }, await loadReportCtx(c, tx, "write")))
}

/** A submission is the member's own attestation: no API key may submit, whatever its scopes (ruling F6/F7). Refused BEFORE the report is even looked up. */
const humanOnly = (c: Context<AppEnv>) => {
  if (c.get("apiKey")) throw Forbidden("human_required")
}

const currentR = createRoute({
  method: "get", path: "/v1/shift-reports/current", middleware: guard("read"),
  responses: { 200: json(CurrentOut, "The caller's OWN running shift, else the last ended one that was not submitted, else null (instants, never wall strings). `reportId` is null until the report is opened. Reporting must be on for the shift's team") },
})
const openR = createRoute({
  method: "post", path: "/v1/shift-reports/open", middleware: guard("write"), request: { body: body(OpenBody) },
  responses: {
    201: json(ReportSchema, "The caller's own draft was created; its rows are the shift's tasks. 404 shift_not_found (not assigned, not a pattern day, a live pattern of someone else, or the shift has not started); 422 reporting_off"),
    200: json(ReportSchema, "The report already existed (idempotent on member, pattern and shift date)"),
  },
})
const getR = createRoute({
  method: "get", path: "/v1/shift-reports/{id}", middleware: guard("read"), request: { params: IdParam },
  responses: { 200: json(ReportSchema, "The report with live task state and evidence state per row. 404 report_not_found (also outside the caller's scope: own, direct reports for a team manager, all for others). Drive links are withheld off the company PC") },
})
const draftR = createRoute({
  method: "put", path: "/v1/shift-reports/{id}/draft", middleware: guard("write"), request: { params: IdParam, body: body(DraftBody) },
  responses: { 200: json(ReportSchema, "The saved draft (version + 1). Owner only: 403 forbidden for any other reader. 404 report_not_found | report_file_not_found; 409 version_conflict | report_locked (submitted or accepted); 422 item_not_in_shift") },
})
const submitR = createRoute({
  method: "post", path: "/v1/shift-reports/{id}/submit", middleware: guard("write"), request: { params: IdParam, body: body(SubmitBody) },
  responses: { 200: json(ReportSchema, "Submitted (or the stored result of an earlier call with the same requestId: no new version). Updates the tasks of the rows. Owner only, a person (never an API key). 403 forbidden | human_required; 404 report_not_found; 409 version_conflict | report_locked | retry; 422 report_invalid with errors[{key,message}]") },
})
const versionsR = createRoute({
  method: "get", path: "/v1/shift-reports/{id}/versions", middleware: guard("read"), request: { params: IdParam },
  responses: { 200: json(VersionsOut, "The frozen submissions, oldest first. Drive links withheld like the report. 404 report_not_found") },
})
const uploadR = createRoute({
  method: "post", path: "/v1/shift-reports/{id}/uploads", middleware: guard("write"), request: { params: IdParam, body: body(UploadBody) },
  responses: { 201: json(UploadIntent, "A presigned PUT (300 s), purpose report_attachment, owner only, at most 5 per report. 403 forbidden; 404 report_not_found; 409 report_locked; 422 mime_not_allowed | file_too_large | invalid_name | attachment_limit") },
})
const completeR = createRoute({
  method: "post", path: "/v1/shift-reports/{id}/uploads/{fileId}/complete", middleware: guard("write"), request: { params: FileParams },
  responses: { 200: json(ReportFileSchema, "Upload confirmed; the malware scan is queued. Idempotent. 404 report_not_found | report_file_not_found; 409 upload_missing; 422 upload_mismatch") },
})
const downloadR = createRoute({
  method: "get", path: "/v1/shift-reports/{id}/files/{fileId}/download", middleware: guard("read"), request: { params: FileParams },
  responses: { 302: { description: "Redirect to a 60 s presigned GET after the scan gate. Never for an API key or a support session. 404 report_not_found | report_file_not_found; 409 file_not_ready; 410 file_infected" } },
})

export const shiftReportRoutes = newRouter()
  .openapi(currentR, async (c) => c.json({ item: await read(c, (tx, ctx) => currentItem(tx, ctx)) }, 200))
  .openapi(openR, async (c) => {
    const { dto, created } = await write(c, async (tx, _env, ctx) => {
      const { row, created } = await openReport(tx, ctx, c.req.valid("json"))
      return { dto: (await reportDtos(tx, ctx, [row]))[0], created }
    })
    return created ? c.json(dto, 201) : c.json(dto, 200)
  })
  .openapi(getR, async (c) => c.json(await read(c, async (tx, ctx) => (await reportDtos(tx, ctx, [await getReport(tx, ctx, c.req.valid("param").id)]))[0]), 200))
  .openapi(draftR, async (c) =>
    c.json(await write(c, async (tx, env, ctx) => (await reportDtos(tx, ctx, [await saveDraft(tx, env.enqueue, ctx, c.req.valid("param").id, c.req.valid("json"))]))[0]), 200),
  )
  .openapi(submitR, async (c) => {
    humanOnly(c)
    return c.json(await write(c, async (tx, env, ctx) => (await reportDtos(tx, ctx, [await submitReport(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))]))[0]), 200)
  })
  .openapi(versionsR, async (c) =>
    c.json({ items: await read(c, async (tx, ctx) => versionDtos(tx, ctx, (await getReport(tx, ctx, c.req.valid("param").id)).id)) }, 200),
  )
  .openapi(uploadR, async (c) => c.json(await reportUploadIntent(c, c.req.valid("param").id, c.req.valid("json")), 201))
  .openapi(completeR, async (c) => {
    const { id, fileId } = c.req.valid("param")
    return c.json(await completeReportUpload(c, id, fileId), 200)
  })
  .openapi(downloadR, async (c) => {
    const { id, fileId } = c.req.valid("param")
    const url = await reportFileDownload(c, id, fileId)
    c.header("Cache-Control", "no-store")
    return c.redirect(url, 302)
  })
