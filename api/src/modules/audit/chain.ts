import { createHash } from "node:crypto"
import { canonicalJson } from "./canonical"

export const GENESIS = "GENESIS"

export type ChainFields = {
  tenantId: string
  seq: number
  at: Date
  actorId: string | null
  action: string
  entity: string
  entityId: string
  before: unknown
  after: unknown
}

/** hash = sha256(prev_hash + canonicalJson({tenantId, seq, at (ISO), actorId, action, entity, entityId, before, after})). */
export function entryHash(prevHash: string, f: ChainFields): string {
  const body = canonicalJson({
    tenantId: f.tenantId,
    seq: f.seq,
    at: f.at.toISOString(),
    actorId: f.actorId,
    action: f.action,
    entity: f.entity,
    entityId: f.entityId,
    before: f.before,
    after: f.after,
  })
  return createHash("sha256").update(prevHash + body).digest("hex")
}
