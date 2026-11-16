import { desc, eq, sql } from "drizzle-orm"
import { auditEvents } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { entryHash, GENESIS } from "./chain"

export type AuditInput = {
  action: string
  entity: string
  entityId: string
  actorId: string | null
  before: unknown
  after: unknown
}

/**
 * Appends one hash-chained entry. Call it inside the same TenantTx as the change being audited:
 * a rollback then removes the audit row too. The per-tenant advisory lock (released at commit/rollback)
 * serialises writers so seq stays gap-free; unique (tenant_id, seq) is the backstop.
 */
export async function recordAudit(tx: TenantTx, tenantId: string, e: AuditInput, now: Date): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenantId}::text))`)
  const [last] = await tx
    .select({ seq: auditEvents.seq, hash: auditEvents.hash })
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, tenantId))
    .orderBy(desc(auditEvents.seq))
    .limit(1)
  const seq = (last?.seq ?? 0) + 1
  const prevHash = last?.hash ?? GENESIS
  // Normalise once (what jsonb will store) and hash + store exactly that, so Dates/undefined/toJSON cannot diverge.
  const norm = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)) ?? null)
  const before = norm(e.before)
  const after = norm(e.after)
  const hash = entryHash(prevHash, { tenantId, seq, at: now, actorId: e.actorId, action: e.action, entity: e.entity, entityId: e.entityId, before, after })
  await tx.insert(auditEvents).values({
    tenantId,
    seq,
    at: now,
    actorId: e.actorId,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    before,
    after,
    prevHash,
    hash,
  })
}
