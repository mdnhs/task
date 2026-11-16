import { and, asc, eq, isNull } from "drizzle-orm"
import type { Deps } from "../../deps"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { domainEvents, eventDeliveries, eventRelayHints } from "../../db/schema"
import { subscribersFor } from "./bus"
import type { DomainEvent, EventType } from "./types"

const DEFAULT_BATCH = 100

/**
 * One relay pass. Returns the number of events fully delivered (every current subscriber done).
 *
 * Algorithm (per tenant that has a hint, discovered without tenant context):
 *  1. withTenant tx: SELECT pending events ORDER BY occurred_at LIMIT batch FOR UPDATE SKIP LOCKED.
 *     Concurrent relays therefore never share an event: whoever locks a row owns it until commit.
 *  2. Per (event, subscriber), inside a savepoint: INSERT event_deliveries ON CONFLICT DO NOTHING RETURNING.
 *     0 rows means already delivered, so the handler is skipped (exactly-once effects). Otherwise the handler runs
 *     on the same tx; a throw rolls back the savepoint (delivery row too), is logged, and the event stays pending.
 *  3. Set relayed_at when every subscriber is done. Events with no subscribers are relayed immediately.
 *  4. Idle hint removal (race-safe): lock the hint row FOR UPDATE, then in a NEW statement re-check for pending
 *     events and delete the hint only if none. publish() upserts the hint with DO UPDATE (takes the same row lock), so
 *     either the publisher holds the lock first (we wait, then see its committed event) or we delete first and the
 *     publisher's upsert re-inserts the hint afterwards. An event cannot end up committed without a hint.
 * The failed event is retried every pass (no backoff); the worker runs a pass each second.
 */
export async function relayOnce(deps: Deps, batch: number = DEFAULT_BATCH): Promise<number> {
  const hints = await deps.db.select({ tenant: eventRelayHints.tenant }).from(eventRelayHints)
  let relayed = 0
  for (const { tenant } of hints) relayed += await relayTenant(deps, tenant, batch)
  return relayed
}

async function relayTenant(deps: Deps, tenantId: string, batch: number): Promise<number> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const pending = await tx
      .select()
      .from(domainEvents)
      .where(isNull(domainEvents.relayedAt))
      .orderBy(asc(domainEvents.occurredAt))
      .limit(batch)
      .for("update", { skipLocked: true })
    let relayed = 0
    for (const row of pending) {
      const event: DomainEvent = {
        id: row.id, tenantId: row.tenantId, type: row.type as EventType, payload: row.payload,
        occurredAt: row.occurredAt, actorId: row.actorId,
      }
      let complete = true
      for (const sub of subscribersFor(event.type)) {
        try {
          await tx.transaction(async (sp) => {
            const claimed = await sp
              .insert(eventDeliveries)
              .values({ tenantId, eventId: event.id, subscriber: sub.name, deliveredAt: deps.clock.now() })
              .onConflictDoNothing()
              .returning({ eventId: eventDeliveries.eventId })
            if (claimed.length === 0) return // already delivered
            await sub.handler(event, { tx: sp as TenantTx, deps })
          })
        } catch (err) {
          complete = false
          deps.logger.error({ eventId: event.id, type: event.type, subscriber: sub.name, error: errorMessage(err) }, "event subscriber failed")
        }
      }
      if (complete) {
        await tx.update(domainEvents).set({ relayedAt: deps.clock.now() }).where(eq(domainEvents.id, event.id))
        relayed++
      }
    }
    await dropHintIfIdle(tx, tenantId)
    return relayed
  })
}

async function dropHintIfIdle(tx: TenantTx, tenantId: string): Promise<void> {
  await tx.select().from(eventRelayHints).where(eq(eventRelayHints.tenant, tenantId)).for("update")
  const [still] = await tx
    .select({ id: domainEvents.id })
    .from(domainEvents)
    .where(and(eq(domainEvents.tenantId, tenantId), isNull(domainEvents.relayedAt)))
    .limit(1)
  if (!still) await tx.delete(eventRelayHints).where(eq(eventRelayHints.tenant, tenantId))
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300)
