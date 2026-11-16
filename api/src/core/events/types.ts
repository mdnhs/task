import type { Deps } from "../../deps"
import type { TenantTx } from "../../db/tenant-tx"

export type EventType =
  | "member.joined" | "member.role_changed" | "invite.created" | "file.uploaded" | "file.scanned"
  | "dsr.requested" | "dsr.completed" | "integration.connected" | "integration.disconnected"

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
   * delivery rolls back. jobId is `${eventId}:${subscriber}:${name}[:${key}]` so retries cannot enqueue duplicates.
   */
  enqueue(name: string, data: unknown, opts?: EnqueueOpts): void
}
export type Subscriber = (e: DomainEvent, ctx: SubscriberCtx) => Promise<void>
