import { and, eq } from "drizzle-orm"
import type { z } from "@hono/zod-openapi"
import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { Conflict, NotFound } from "../../core/errors"
import { subjectUserId } from "../../core/middleware/principal"
import { files, shiftReportFiles } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { ALLOWED_MIMES, completeUpload, createUpload, reportFileDownloadUrl, type UploadPolicy } from "../files"
import { unprocessable } from "../tasks"
import { liveAttachmentIds } from "./draft"
import { LIMITS, type UploadBody } from "./dto"
import { assertOwner, editable, getReport, loadReportCtx, type ReportCtx } from "./scope"

const FileNotFound = () => NotFound("report_file_not_found")

/** The B2 mime list and size cap, purpose `report_attachment` (ruling F16): reachable only through these routes, never /v1/files, search or webhooks. */
function policyFor(c: Context<AppEnv>, lock: UploadPolicy["lock"], after?: UploadPolicy["after"]): UploadPolicy {
  return { purpose: "report_attachment", mimes: ALLOWED_MIMES, maxBytes: () => c.get("deps").env.FILE_MAX_BYTES, lock, after }
}

/**
 * Who may put a file on the report: its OWNER (403 for any other reader), the report must be in the caller's scope first (404). The row is locked FOR UPDATE and held to
 * commit, so the count of five is checked under the same lock the insert happens under (concurrent intents cannot reach six) and a submit cannot slip between.
 * `intent` also requires the report to be editable (409 report_locked) and under the limit (422 attachment_limit); `complete` only needs ownership.
 */
async function authorise(tx: TenantTx, ctx: ReportCtx, reportId: string, o: { intent: boolean }): Promise<void> {
  const row = await getReport(tx, ctx, reportId, { forUpdate: true })
  assertOwner(ctx, row)
  if (!o.intent) return
  if (!editable(row.status)) throw Conflict("report_locked")
  if ((await liveAttachmentIds(tx, ctx.tenantId, reportId)).length >= LIMITS.attachments) throw unprocessable("attachment_limit")
}

/** POST /v1/shift-reports/{id}/uploads: the B2 presign pipeline under the report policy (needs M1 and reports:write, not M4 and files:write). */
export async function reportUploadIntent(c: Context<AppEnv>, reportId: string, input: z.infer<typeof UploadBody>) {
  let ctx: ReportCtx | undefined
  const policy = policyFor(
    c,
    async (tx) => {
      ctx = await loadReportCtx(c, tx, "write") // actor lock first (R25), then the report row
      await authorise(tx, ctx, reportId, { intent: true })
    },
    async (tx, fileId) => {
      await tx.insert(shiftReportFiles).values({ fileId, tenantId: ctx!.tenantId, reportId, userId: ctx!.me, createdAt: ctx!.now })
    },
  )
  return createUpload(c.get("deps"), c.get("tenant")!.id, { userId: subjectUserId(c) }, input, policy)
}

/** The attachment row of THIS report (404 report_not_found first, then 404 report_file_not_found: another report's file id looks like a missing one). */
async function fileOf(tx: TenantTx, ctx: ReportCtx, reportId: string, fileId: string) {
  const report = await getReport(tx, ctx, reportId)
  const [f] = await tx
    .select({ status: files.status })
    .from(shiftReportFiles)
    .innerJoin(files, and(eq(files.tenantId, shiftReportFiles.tenantId), eq(files.id, shiftReportFiles.fileId)))
    .where(and(eq(shiftReportFiles.tenantId, ctx.tenantId), eq(shiftReportFiles.reportId, report.id), eq(shiftReportFiles.fileId, fileId)))
  if (!f || f.status === "deleted") throw FileNotFound()
}

/** POST /v1/shift-reports/{id}/uploads/{fileId}/complete: idempotent, queues the scan (B2 completeUpload under the report policy). */
export async function completeReportUpload(c: Context<AppEnv>, reportId: string, fileId: string) {
  const tenantId = c.get("tenant")!.id
  const deps = c.get("deps")
  await withTenant(deps.db, tenantId, async (tx) => fileOf(tx, await loadReportCtx(c, tx), reportId, fileId))
  const policy = policyFor(c, async (tx) => {
    const ctx = await loadReportCtx(c, tx, "write")
    await authorise(tx, ctx, reportId, { intent: false })
    await fileOf(tx, ctx, reportId, fileId)
  })
  return completeUpload(deps, tenantId, { userId: subjectUserId(c) }, fileId, policy)
}

/** GET /v1/shift-reports/{id}/files/{fileId}/download: needs access to the REPORT (scope), then the scan gate; returns the 60 s presigned GET. */
export async function reportFileDownload(c: Context<AppEnv>, reportId: string, fileId: string): Promise<string> {
  const tenantId = c.get("tenant")!.id
  await withTenant(c.get("deps").db, tenantId, async (tx) => fileOf(tx, await loadReportCtx(c, tx), reportId, fileId))
  return reportFileDownloadUrl(c.get("deps"), tenantId, fileId)
}
