import { and, eq } from "drizzle-orm"
import type { z } from "@hono/zod-openapi"
import { canReview } from "@opsdesk/domain/permissions"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { Conflict, Forbidden } from "../../core/errors"
import { shiftReportComments, shiftReports } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { notify, type Enqueue } from "../notifications"
import { unprocessable } from "../tasks"
import type { AcceptBody, ReturnBody } from "./dto"
import { publishReportEvent } from "./events"
import { getReport, type ReportCtx, type ReportRow } from "./scope"

export type ReviewDecision = "accept" | "return"
type ReviewInput = z.infer<typeof AcceptBody> | z.infer<typeof ReturnBody>

/**
 * POST /{id}/accept and /{id}/return (ruling F6, D8). A review is a PERSON'S decision about someone else's work, so the order of the checks is the point, and every refusal happens before anything is written:
 *   1. the caller's role may review at all (manager-home with `reports:write`, `canReview`); a staff-home role is 403 forbidden whatever the id (the answer does not depend on the report, so it is no oracle);
 *   2. the report row FOR UPDATE inside the caller's scope: unknown, another tenant's and out-of-scope all give the same 404 report_not_found (an out-of-scope reviewer learns nothing);
 *   3. INDEPENDENCE: the report's owner is the caller (or the person the caller acts as) → 403 self_review, manager or owner alike, decided before the version and the state so it hints at nothing;
 *   4. a return needs a comment (422 comment_required: blank is blank);
 *   5. `version` (409 version_conflict) and then the state: only `submitted` can be reviewed (409 report_not_submitted).
 * Two reviewers (or a reviewer and the member) meet at the row lock in step 2: the second one reads the new version or the new state and gets a clean 409, so exactly one wins.
 * The API key refusal (403 human_required) is the route's, before any lookup. Lock order (E8-E10): actor lock (loadReportCtx) → report row → writes → notify → audit → publish LAST.
 * The decision bumps `version` (the optimistic token), stamps the reviewer (the ACTOR) and, when there is a comment, stores it (the text is stored as written and withheld on read, F10; no text goes to
 * the notification, the audit or the event). The member is told either way (kind `report`, shift name and date only, E13).
 */
export async function reviewReport(tx: TenantTx, env: { deps: Deps; enqueue: Enqueue }, ctx: ReportCtx, id: string, decision: ReviewDecision, input: ReviewInput): Promise<ReportRow> {
  if (!canReview(ctx.role)) throw Forbidden("forbidden")
  const row = await getReport(tx, ctx, id, { forUpdate: true })
  if (row.userId !== null && (row.userId === ctx.me || row.userId === ctx.actorId)) throw Forbidden("self_review")
  const comment = (input.comment ?? "").trim()
  if (decision === "return" && !comment) throw unprocessable("comment_required")
  if (input.version !== row.version) throw Conflict("version_conflict")
  if (row.status !== "submitted") throw Conflict("report_not_submitted")

  const status = decision === "accept" ? "accepted" : "returned"
  const [out] = await tx
    .update(shiftReports)
    .set({ status, reviewedAt: ctx.now, reviewedBy: ctx.actorId, version: row.version + 1, updatedAt: ctx.now })
    .where(and(eq(shiftReports.id, id), eq(shiftReports.tenantId, ctx.tenantId), eq(shiftReports.status, "submitted"), eq(shiftReports.version, row.version)))
    .returning()
  if (comment) await tx.insert(shiftReportComments).values({ tenantId: ctx.tenantId, reportId: id, at: ctx.now, byUser: ctx.actorId, kind: decision, text: comment })
  if (row.userId && row.userId !== ctx.actorId) {
    await notify(
      tx, ctx.tenantId,
      { userId: row.userId, kind: "report", title: decision === "accept" ? "Shift report accepted" : "Shift report returned", body: `${withholdDriveText(row.shiftName)}, ${row.shiftDate}`, link: `/reports/${id}` },
      env.deps, env.enqueue,
    )
  }
  await recordAudit(
    tx, ctx.tenantId,
    { action: decision === "accept" ? "shift.report.accepted" : "shift.report.returned", entity: "shift_report", entityId: id, actorId: ctx.actorId, before: { status: row.status, version: row.version }, after: { status, version: out.version, decision } },
    ctx.now,
  )
  await publishReportEvent(tx, ctx, { type: decision === "accept" ? "shift.report.accepted" : "shift.report.returned", payload: { reportId: id, version: out.version } })
  return out
}
