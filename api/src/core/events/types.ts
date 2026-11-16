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

export type SubscriberCtx = { tx: TenantTx; deps: Deps }
export type Subscriber = (e: DomainEvent, ctx: SubscriberCtx) => Promise<void>
