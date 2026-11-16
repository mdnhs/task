import { sql } from "drizzle-orm"
import { domainEvents, eventRelayHints } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { DomainEvent, EventType, Subscriber } from "./types"

/**
 * Domain-event bus: transactional outbox + relay (relay.ts).
 *
 * Contract for subscribers (ruling B2):
 *  - A subscriber is invoked as `(event, { tx, deps })` at-least-once by the relay, but its effects happen exactly once:
 *    the `event_deliveries` row (ON CONFLICT DO NOTHING) and the handler's DB writes share `ctx.tx` (a savepoint of the
 *    relay's per-tenant transaction). If the handler throws, the savepoint rolls back, delivery row included, and the
 *    event is retried on the next relay pass. A second relay of an already-delivered (event, subscriber) skips the handler.
 *  - Do DB effects through `ctx.tx` ONLY (never `deps.db`), so they commit or roll back with the delivery row.
 *  - External side effects (mail, push, HTTP) must NOT run inside the handler: enqueue them with `deps.queue.add(...)`.
 *    Jobs run after commit, so a rolled-back delivery can never leak a mail. Use a deterministic `jobId`
 *    (e.g. `${event.id}:${name}`) so a retried delivery cannot enqueue duplicates.
 *  - Subscriber names are unique across the registry; the name is part of the delivery key.
 */
type Registered = { type: EventType | "*"; name: string; handler: Subscriber }
const registry: Registered[] = []

export function subscribe(type: EventType | "*", name: string, handler: Subscriber): void {
  if (registry.some((r) => r.name === name)) throw new Error(`Duplicate event subscriber name: ${name}`)
  registry.push({ type, name, handler })
}

/** Removes every subscriber (tests: call in beforeEach/afterEach to avoid cross-test leakage). */
export function resetSubscribers(): void {
  registry.length = 0
}

export function subscribersFor(type: EventType): { name: string; handler: Subscriber }[] {
  return registry.filter((r) => r.type === "*" || r.type === type).map(({ name, handler }) => ({ name, handler }))
}

/**
 * Writes the event in the caller's tenant tx (rollback removes it) and marks the tenant as having pending events.
 * The hint upsert uses DO UPDATE (not DO NOTHING) on purpose: it takes the hint row lock, which the relay's
 * "delete hint when idle" step also takes, so an event can never be stranded without a hint (see relay.ts).
 */
export async function publish(tx: TenantTx, e: Omit<DomainEvent, "id" | "occurredAt">, now: Date): Promise<string> {
  const [row] = await tx
    .insert(domainEvents)
    .values({ tenantId: e.tenantId, type: e.type, payload: e.payload, actorId: e.actorId, occurredAt: now })
    .returning({ id: domainEvents.id })
  await tx
    .insert(eventRelayHints)
    .values({ tenant: e.tenantId })
    .onConflictDoUpdate({ target: eventRelayHints.tenant, set: { tenant: sql`excluded.tenant` } })
  return row.id
}
