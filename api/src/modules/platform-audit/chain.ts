import { createHash } from "node:crypto"
import { canonicalJson } from "../audit/canonical"

export { GENESIS } from "../audit/chain"

/**
 * Advisory-lock namespace for the platform tables: the two-key form pg_advisory_xact_lock(int4, int4). The tenant audit
 * uses the single-key int8 form (hashtext(tenant)), a different lock space, so the two can never collide.
 * Lock order inside a transaction: staff lock first, audit lock LAST (recordPlatformAudit takes it).
 */
export const PLATFORM_LOCK_NS = 0x504c4154 // "PLAT"
export const PLATFORM_AUDIT_LOCK = 1
export const PLATFORM_STAFF_LOCK = 2

export type PlatformChainFields = {
  seq: number
  at: Date
  actorId: string
  action: string
  entity: string
  entityId: string
  targetTenantId: string | null
  before: unknown
  after: unknown
}

/**
 * hash = sha256(prev_hash + canonicalJson({chain: "platform", seq, at (ISO), actorId, action, entity, entityId, targetTenantId, before, after})).
 * Same canonical form as the tenant chain; the "platform" chain id takes the place of tenantId.
 */
export function platformEntryHash(prevHash: string, f: PlatformChainFields): string {
  const body = canonicalJson({
    chain: "platform",
    seq: f.seq,
    at: f.at.toISOString(),
    actorId: f.actorId,
    action: f.action,
    entity: f.entity,
    entityId: f.entityId,
    targetTenantId: f.targetTenantId,
    before: f.before,
    after: f.after,
  })
  return createHash("sha256").update(prevHash + body).digest("hex")
}
