import { and, asc, eq, isNull, notExists, sql } from "drizzle-orm"
import type { Deps } from "../../deps"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { domainEvents, eventDeliveries, eventDeliveryFailures, eventRelayHints } from "../../db/schema"
import { subscribersFor } from "./bus"
import type { DomainEvent, EnqueueOpts, EventType } from "./types"

const DEFAULT_BATCH = 100
export const MAX_ATTEMPTS = 10
const MAX_BACKOFF_S = 3600

type JobIntent = { name: string; data: unknown; opts: { delayMs?: number; jobId: string } }

/**
 * One relay pass. Returns the number of events completed (every current subscriber delivered or dead).
 *
 * Algorithm (per tenant that has a hint, discovered without tenant context; each tenant in its own try/catch):
 *  1. withTenant tx: SELECT pending events ORDER BY occurred_at LIMIT batch FOR UPDATE SKIP LOCKED, skipping events
 *     that have a (non-dead) failure whose next_attempt_at is still in the future, so backing-off events never
 *     starve newer ones. Concurrent relays never share an event: whoever locks a row owns it until commit.
 *  2. Per (event, subscriber), inside a savepoint: INSERT event_deliveries ON CONFLICT DO NOTHING RETURNING.
 *     0 rows means already delivered, so the handler is skipped. Otherwise the handler runs on the same tx. A throw
 *     rolls back the savepoint (delivery row, DB effects and buffered enqueues together); the relay then upserts the
 *     failure row (attempts+1, next_attempt_at = now + min(2^attempts s, 1 h)); at MAX_ATTEMPTS it is marked dead.
 *  3. relayed_at is set when every subscriber is delivered or dead (no subscribers: immediately).
 *  4. Buffered enqueue intents are flushed to deps.queue only after the tenant tx has committed.
 *  5. Race-safe hint removal: lock the hint row FOR UPDATE, then in a NEW statement re-check for events with
 *     relayed_at IS NULL (including backing-off ones) and delete the hint only if none. publish() upserts with DO
 *     UPDATE (same row lock), so an event can never be committed without a hint.
 * Logs carry only the error name and pg cause code (never messages: Drizzle messages embed query params).
 */
export async function relayOnce(deps: Deps, batch: number = DEFAULT_BATCH): Promise<number> {
  const hints = await deps.db.select({ tenant: eventRelayHints.tenant }).from(eventRelayHints)
  let relayed = 0
  for (const { tenant } of hints) {
    try {
      const r = await relayTenant(deps, tenant, batch)
      relayed += r.relayed
      for (const j of r.jobs) {
        try {
          await deps.queue.add(j.name, j.data, j.opts)
        } catch (err) {
          deps.logger.error({ tenantId: tenant, job: j.name, ...errorInfo(err) }, "event job enqueue failed after commit")
        }
      }
    } catch (err) {
      deps.logger.error({ tenantId: tenant, ...errorInfo(err) }, "event relay failed for tenant")
    }
  }
  return relayed
}

async function relayTenant(deps: Deps, tenantId: string, batch: number): Promise<{ relayed: number; jobs: JobIntent[] }> {
  const jobs: JobIntent[] = []
  const relayed = await withTenant(deps.db, tenantId, async (tx) => {
    const now = deps.clock.now()
    const pending = await tx
      .select()
      .from(domainEvents)
      .where(
        and(
          isNull(domainEvents.relayedAt),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(eventDeliveryFailures)
              .where(and(eq(eventDeliveryFailures.eventId, domainEvents.id), isNull(eventDeliveryFailures.deadAt), sql`${eventDeliveryFailures.nextAttemptAt} > ${now}`)),
          ),
        ),
      )
      .orderBy(asc(domainEvents.occurredAt))
      .limit(batch)
      .for("update", { skipLocked: true })
    let done = 0
    for (const row of pending) {
      const event: DomainEvent = {
        id: row.id, tenantId: row.tenantId, type: row.type as EventType, payload: row.payload,
        occurredAt: row.occurredAt, actorId: row.actorId,
      }
      const failures = new Map(
        (await tx.select().from(eventDeliveryFailures).where(eq(eventDeliveryFailures.eventId, event.id))).map((f) => [f.subscriber, f]),
      )
      let complete = true
      for (const sub of subscribersFor(event.type)) {
        const prior = failures.get(sub.name)
        if (prior?.deadAt) continue // dead counts as done
        const buffered: JobIntent[] = []
        const enqueue = (name: string, data: unknown, o?: EnqueueOpts) =>
          void buffered.push({
            name, data,
            opts: { delayMs: o?.delayMs, jobId: `${event.id}:${sub.name}:${name}${o?.key ? `:${o.key}` : ""}` },
          })
        try {
          await tx.transaction(async (sp) => {
            const claimed = await sp
              .insert(eventDeliveries)
              .values({ tenantId, eventId: event.id, subscriber: sub.name, deliveredAt: now })
              .onConflictDoNothing()
              .returning({ eventId: eventDeliveries.eventId })
            if (claimed.length === 0) return // already delivered
            await sub.handler(event, { tx: sp as TenantTx, deps, enqueue })
          })
          jobs.push(...buffered)
          if (prior) await tx.delete(eventDeliveryFailures).where(and(eq(eventDeliveryFailures.eventId, event.id), eq(eventDeliveryFailures.subscriber, sub.name)))
        } catch (err) {
          const info = errorInfo(err)
          const attempts = (prior?.attempts ?? 0) + 1
          const dead = attempts >= MAX_ATTEMPTS
          const next = new Date(now.getTime() + Math.min(2 ** attempts, MAX_BACKOFF_S) * 1000)
          const set = { attempts, nextAttemptAt: next, lastErrorCode: info.code ?? info.name, deadAt: dead ? now : null }
          await tx
            .insert(eventDeliveryFailures)
            .values({ tenantId, eventId: event.id, subscriber: sub.name, ...set })
            .onConflictDoUpdate({ target: [eventDeliveryFailures.eventId, eventDeliveryFailures.subscriber], set })
          if (!dead) complete = false
          deps.logger.error({ eventId: event.id, type: event.type, subscriber: sub.name, attempts, dead, ...info }, "event subscriber failed")
        }
      }
      if (complete) {
        await tx.update(domainEvents).set({ relayedAt: now }).where(eq(domainEvents.id, event.id))
        done++
      }
    }
    await dropHintIfIdle(tx, tenantId)
    return done
  })
  return { relayed, jobs }
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

/** Only the error class name and the pg SQLSTATE (`cause.code`), never the message. */
function errorInfo(e: unknown): { name: string; code?: string } {
  const name = e instanceof Error ? e.name : "NonError"
  const cause = (e as { cause?: { code?: unknown } } | null)?.cause
  const own = (e as { code?: unknown } | null)?.code
  const code = typeof cause?.code === "string" ? cause.code : typeof own === "string" ? own : undefined
  return { name, code }
}
