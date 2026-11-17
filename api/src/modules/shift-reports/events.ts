import { publish } from "../../core/events"
import type { TenantTx } from "../../db/tenant-tx"

/** Report domain events (ruling F19): ids only, never a name or free text; NOT in the webhook projection (D14). Call LAST in a mutation (publish takes the relay-hint lock). */
export type ReportEvent =
  | { type: "shift.report.submitted" | "shift.report.accepted" | "shift.report.returned"; payload: { reportId: string; version: number } }
  | { type: "shift.report.missing"; payload: { userId: string; patternId: string; shiftDate: string } } // published by the deadline job, once per ledger row
  | { type: "report.export_completed"; payload: { exportId: string } } // published by the export job, once (T5.5)

export async function publishReportEvent(tx: TenantTx, ctx: { tenantId: string; actorId: string; now: Date }, e: ReportEvent): Promise<void> {
  await publish(tx, { tenantId: ctx.tenantId, type: e.type, payload: e.payload, actorId: ctx.actorId }, ctx.now)
}
