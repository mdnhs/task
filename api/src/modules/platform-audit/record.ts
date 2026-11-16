import { desc, sql } from "drizzle-orm"
import { platformAuditEvents } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { GENESIS, PLATFORM_AUDIT_LOCK, PLATFORM_LOCK_NS, platformEntryHash } from "./chain"

/** A transaction on the app_user connection. Platform tables have no RLS, so no tenant context is needed. */
export type PlatformTx = TenantTx

export type PlatformAuditInput = {
  action: string
  entity: string
  entityId: string
  actorId: string
  targetTenantId?: string
  before: unknown
  after: unknown
}

/**
 * Appends one entry to the single platform chain. Call it inside the same transaction as the change being audited
 * (a rollback then removes the entry too). The platform advisory lock serialises writers so seq stays gap-free;
 * unique (seq) is the backstop. before/after must hold ids and secrets-free snapshots only: no raw emails, no secrets.
 */
export async function recordPlatformAudit(tx: PlatformTx, e: PlatformAuditInput, now: Date): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(${PLATFORM_LOCK_NS}::int4, ${PLATFORM_AUDIT_LOCK}::int4)`)
  const [last] = await tx
    .select({ seq: platformAuditEvents.seq, hash: platformAuditEvents.hash })
    .from(platformAuditEvents)
    .orderBy(desc(platformAuditEvents.seq))
    .limit(1)
  const seq = (last?.seq ?? 0) + 1
  const prevHash = last?.hash ?? GENESIS
  // Normalise once (what jsonb will store) and hash + store exactly that.
  const norm = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)) ?? null)
  const before = norm(e.before)
  const after = norm(e.after)
  const targetTenantId = e.targetTenantId ?? null
  const hash = platformEntryHash(prevHash, { seq, at: now, actorId: e.actorId, action: e.action, entity: e.entity, entityId: e.entityId, targetTenantId, before, after })
  await tx.insert(platformAuditEvents).values({ seq, at: now, actorId: e.actorId, action: e.action, entity: e.entity, entityId: e.entityId, targetTenantId, before, after, prevHash, hash })
}
