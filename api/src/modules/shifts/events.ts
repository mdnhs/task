import { publish } from "../../core/events"
import type { TenantTx } from "../../db/tenant-tx"

/**
 * Shift domain events (F19): ids only, never a name, a time or a person's text. They are NOT in the webhook projection allow-list
 * (D14). Call these LAST in a mutation (publish takes the relay-hint lock, see core/events/bus.ts).
 */
export type ShiftEvent =
  | { type: "shift.pattern_created" | "shift.pattern_updated" | "shift.pattern_archived"; payload: { patternId: string } }
  | { type: "shift.assigned" | "shift.unassigned"; payload: { assignmentId: string; patternId: string; userId: string } }
  | { type: "shift.reporting_changed"; payload: { teamId: string | null; userId: string | null } }

export async function publishShiftEvent(tx: TenantTx, ctx: { tenantId: string; actorId: string; now: Date }, e: ShiftEvent): Promise<void> {
  await publish(tx, { tenantId: ctx.tenantId, type: e.type, payload: e.payload, actorId: ctx.actorId }, ctx.now)
}
