import { and, asc, eq, gt } from "drizzle-orm"
import type { Db } from "../../db/client"
import { auditEvents } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { entryHash, GENESIS } from "./chain"

const BATCH = 1000

/**
 * Walks the tenant's chain in seq order and recomputes every hash. Returns the id of the first row that
 * does not fit (edited content, edited hash, broken prev link, or a seq gap from a deleted row).
 *
 * Reads through withTenant as app_user: the RLS policy only filters by tenant_id, so it can never hide a
 * row inside this tenant's chain (a hidden row would be a false "ok"), and it needs no owner credentials.
 * Limit: deleting the newest rows cannot be seen from the table alone (needs an external anchor).
 */
export async function verifyChain(db: Db, tenantId: string): Promise<{ ok: true; head: { seq: number; hash: string } | null } | { ok: false; brokenAt: string }> {
  return withTenant(db, tenantId, async (tx) => {
    let prev = GENESIS
    let expected = 1
    for (;;) {
      const batch = await tx
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.tenantId, tenantId), gt(auditEvents.seq, expected - 1)))
        .orderBy(asc(auditEvents.seq))
        .limit(BATCH)
      if (batch.length === 0) return { ok: true as const, head: expected === 1 ? null : { seq: expected - 1, hash: prev } }
      for (const r of batch) {
        const good = r.seq === expected && r.prevHash === prev && r.hash === entryHash(prev, r) && r.tenantId === tenantId
        if (!good) return { ok: false as const, brokenAt: r.id }
        prev = r.hash
        expected++
      }
    }
  })
}
