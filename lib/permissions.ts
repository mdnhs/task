import { canWriteFor } from "@opsdesk/domain/permissions"
import type { Module, Role, Tenant } from "./types"

export * from "@opsdesk/domain/permissions"

/** Suspended tenants are read-only (FR-SAAS-08): the session's role may write the module and its tenant is not suspended. Pure. */
export function canWrite(s: { role: Role; tenant: { status: Tenant["status"] } }, m: Module): boolean {
  return canWriteFor(s.role, s.tenant.status, m)
}
