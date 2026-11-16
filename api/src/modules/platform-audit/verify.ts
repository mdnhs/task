import { asc, gt } from "drizzle-orm"
import type { Db } from "../../db/client"
import { platformAuditEvents } from "../../db/schema"
import { GENESIS, platformEntryHash } from "./chain"

const BATCH = 1000

/**
 * Walks the platform chain in seq order and recomputes every hash. Returns the id of the first row that does not fit
 * (edited content, edited hash, broken prev link, or a seq gap from a deleted row). Limit: deleting the newest rows cannot
 * be seen from the table alone (needs an external anchor).
 */
export async function verifyPlatformChain(db: Db): Promise<{ ok: true; head: { seq: number; hash: string } | null } | { ok: false; brokenAt: string }> {
  let prev = GENESIS
  let expected = 1
  for (;;) {
    const batch = await db.select().from(platformAuditEvents).where(gt(platformAuditEvents.seq, expected - 1)).orderBy(asc(platformAuditEvents.seq)).limit(BATCH)
    if (batch.length === 0) return { ok: true as const, head: expected === 1 ? null : { seq: expected - 1, hash: prev } }
    for (const r of batch) {
      if (!(r.seq === expected && r.prevHash === prev && r.hash === platformEntryHash(prev, r))) return { ok: false as const, brokenAt: r.id }
      prev = r.hash
      expected++
    }
  }
}
