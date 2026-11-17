/** One row of the tenant's audit log (GET /v1/audit), mapped. `at` is the tenant's wall clock; `actor` is a name (or "System"). Metadata is flat text, never a nested dump. */
export type AuditEvent = {
  id: string
  seq: number
  at: string
  actorId: string | null
  actor: string
  /** The API's action, for example "invite.created". The label comes from actions-catalogue.ts. */
  action: string
  recordType: string
  recordRef: string
  sensitive: boolean
  meta: Record<string, string>
}

export type AuditFilters = { q: string; actor: string; action: string; recordType: string; from: string; to: string }
