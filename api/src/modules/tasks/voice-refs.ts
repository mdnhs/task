import { and, eq, inArray, sql } from "drizzle-orm"
import { tasks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"

// Shared by purge (archive.ts) and voice replace / clear (voice.ts): the lock that serialises "is this voice file still used elsewhere?" and the check itself.
//
// WHY ONE LOCK. A voice file can be pointed at by several tasks (a recurring series and its instances share it, ruling D21). Whoever drops a reference
// (replace, clear, purge) asks "does any other task still point at it?" and deletes the file when not. Two droppers in parallel would each see the
// other's row still pointing at the file (READ COMMITTED: uncommitted updates are invisible) and both keep it: an orphan nobody ever deletes.
// TASK_PURGE_LOCK_NS is a per-tenant advisory lock taken FIRST (before the actor lock and any task row), so those check-and-delete steps run one at a time.
// The recurrence job needs no such lock: it copies the file id from the series row it holds FOR UPDATE, and every dropper that touches a series (or
// anything the series shares) either holds that row too or is serialised by this lock; see voice.ts for the full argument.

/** Two-key advisory lock namespace for purges and voice drops of one tenant ("tprn"), same pattern as TASK_GRAPH_LOCK_NS. */
export const TASK_PURGE_LOCK_NS = 0x7470726e
export const lockTaskPurge = (tx: TenantTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(${TASK_PURGE_LOCK_NS}::int, hashtext(${tenantId}::text))`)

/**
 * For each given voice file id, ONE task other than `exceptTaskId` that still points at it (live tasks before archived ones, then by id, so the answer is
 * stable); files nobody else uses are absent from the map. Archived tasks count: a restore must find its note. The caller holds the purge lock.
 */
export async function voiceHolders(tx: TenantTx, tenantId: string, fileIds: string[], exceptTaskId: string): Promise<Map<string, string>> {
  if (fileIds.length === 0) return new Map()
  const rows = await tx
    .select({ fileId: tasks.voiceFileId, holder: sql<string>`(array_agg(${tasks.id} order by (${tasks.archivedAt} is not null), ${tasks.id}))[1]` })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), inArray(tasks.voiceFileId, fileIds), sql`${tasks.id} <> ${exceptTaskId}`))
    .groupBy(tasks.voiceFileId)
  return new Map(rows.map((r) => [r.fileId!, r.holder]))
}

/** Does any task other than `exceptTaskId` still point at this voice file? Call it under the purge lock, before deciding to delete the file. */
export async function voiceFileStillReferenced(tx: TenantTx, tenantId: string, fileId: string, exceptTaskId: string): Promise<boolean> {
  return (await voiceHolders(tx, tenantId, [fileId], exceptTaskId)).has(fileId)
}
