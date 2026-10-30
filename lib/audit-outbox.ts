// Hand-off for audit events recorded outside the audit log screen (FR-M0-13), e.g. a task purged for good from the tasks
// archive. Features can't import each other, so the acting feature pushes here and the audit store merges these in when the
// audit log mounts (features/audit/filters.ts mergeOutbox). Module state like lib/task-inbox.ts: survives client
// navigation, resets on reload; a backend would write the audit row on the server instead.

export type OutboxAuditEvent = {
  /** Unique per event, so pushing or merging twice is a no-op. */
  key: string
  /** Only this tenant's audit log takes it (FR-SAAS-02). */
  tenantId: string
  /** Tenant wall clock, YYYY-MM-DDTHH:mm:ss. */
  at: string
  actor: string
  actorRole: string
  /** An audit action id (features/audit/types.ts AuditAction). */
  action: string
  recordType: string
  recordRef: string
  sensitive: boolean
  meta: Record<string, string>
}

const events: OutboxAuditEvent[] = []

export const auditOutbox = {
  push(e: OutboxAuditEvent) {
    if (!events.some((x) => x.key === e.key)) events.push(e)
  },
  /** Only the given tenant's events, oldest first. */
  list: (tenantId: string): OutboxAuditEvent[] => events.filter((e) => e.tenantId === tenantId),
  /** Tests only. */
  reset() {
    events.length = 0
  },
}
