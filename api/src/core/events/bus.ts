import { sql } from "drizzle-orm"
import { domainEvents, eventRelayHints } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { DomainEvent, EventType, Subscriber } from "./types"

/**
 * Domain-event bus: transactional outbox + relay (relay.ts).
 *
 * Contract for subscribers (ruling B2):
 *  - A subscriber is invoked as `(event, { tx, deps, enqueue })` at-least-once by the relay, but its effects happen
 *    exactly once: the `event_deliveries` row (ON CONFLICT DO NOTHING) and the handler's DB writes share `ctx.tx` (a
 *    savepoint of the relay's per-tenant transaction). If the handler throws, the savepoint rolls back, delivery row
 *    included, and the event is retried with exponential backoff (dead after 10 attempts, see relay.ts).
 *    A second relay of an already-delivered (event, subscriber) skips the handler.
 *  - Do DB effects through `ctx.tx` ONLY (never `deps.db`), so they commit or roll back with the delivery row.
 *  - External side effects (mail, push, HTTP) must NOT run in the handler and must NOT call `deps.queue.add` directly:
 *    use `ctx.enqueue(name, data)`. Intents are buffered, discarded if the delivery rolls back, and flushed to
 *    `deps.queue` only AFTER the tenant tx commits, with a stable jobId so retries do not duplicate jobs.
 *    (If the flush itself fails after commit the job is lost and an error is logged; there is no redelivery.)
 *  - Subscriber names are unique across the registry; the name is part of the delivery key.
 *
 * Lock-order rule for publishers: inside a request tx call recordAudit FIRST and publish LAST (publish takes the
 * relay-hint row lock, which the relay also takes; keeping it last keeps that lock held for the shortest time and
 * avoids lock-order inversions with the per-tenant audit advisory lock).
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
