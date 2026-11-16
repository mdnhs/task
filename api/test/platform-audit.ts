import { ownerQuery } from "./db"

/** The persistent platform audit entries (oldest first), read as owner; replaces the removed InMemoryAuditSink in tests. */
export async function platformAuditEntries(): Promise<{ action: string; actorId: string; before: any; after: any }[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const rows = await ownerQuery("select action, actor_id, before, after from platform_audit_events order by seq")
  return rows.map((r) => ({ action: String(r.action), actorId: String(r.actor_id), before: r.before, after: r.after }))
}
