import type { Deps } from "../../deps"
import type { TenantTx } from "../../db/tenant-tx"

export type EventType =
  | "member.joined" | "member.role_changed" | "invite.created" | "file.uploaded" | "file.scanned"
  | "member.removed" | "team.created" | "team.updated" | "team.deleted" | "file.deleted"
  | "dsr.requested" | "dsr.completed" | "integration.connected" | "integration.disconnected" | "billing.subscription_changed" | "billing.payment_failed"
  | "task.created" | "task.updated" | "task.assigned" | "task.status_changed" | "task.completed" | "task.submitted"
  | "task.evidence_added" | "task.evidence_verified" | "task.evidence_rejected"
  | "task.comment_added" | "task.archived" | "task.restored" | "task.purged"
  | "project.created" | "project.updated" | "project.deleted"
  | "shift.pattern_created" | "shift.pattern_updated" | "shift.pattern_archived" | "shift.assigned" | "shift.unassigned" | "shift.reporting_changed"

export type DomainEvent = {
  id: string
  tenantId: string
  type: EventType
  payload: Record<string, unknown>
  occurredAt: Date
  actorId: string | null
}

export type EnqueueOpts = { delayMs?: number; key?: string }
export type SubscriberCtx = {
  tx: TenantTx
  deps: Deps
  /**
   * Buffers a background job. It reaches deps.queue only after the relay's tenant tx COMMITS, and is dropped if this
   * delivery rolls back. jobId is a sha256 hex of (eventId, subscriber, name, key) so retries cannot enqueue duplicates.
   */
  enqueue(name: string, data: unknown, opts?: EnqueueOpts): void
}
export type Subscriber = (e: DomainEvent, ctx: SubscriberCtx) => Promise<void>
