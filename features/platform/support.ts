import { requireStaff } from "./permissions"
import type { AuditEntry, PlatformSeed, PlatformTenant, StaffMember, SupportRequest } from "./types"

// The /platform/support view model (final review I1), built on the server like tenants.ts. Only what the page renders
// reaches the client: tenant names (the table and the request dialog), the support requests, and, with audit.read, the
// support-access lines of the audit log (support.* actions; no before/after or reason). No invoices, subscription
// events, usage or data requests (D3, D8). Writes follow the patch contract: requests go to the support store, audit
// lines to auditOutbox (store.ts).

export const SUPPORT_ACTION_PREFIX = "support."
export const isSupportAction = (action: string) => action.startsWith(SUPPORT_ACTION_PREFIX)

/** The audit fields the support page lists. */
export type SupportAuditLine = Pick<AuditEntry, "id" | "at" | "actor" | "action" | "target" | "detail">
export type SupportData = {
  tenants: Pick<PlatformTenant, "id" | "name">[]
  requests: SupportRequest[]
  /** Support-access audit lines, newest first; null without audit.read (the card is hidden). */
  audit: SupportAuditLine[] | null
}

const toLine = ({ id, at, actor, action, target, detail }: AuditEntry): SupportAuditLine => ({ id, at, actor, action, target, detail })

export function supportData(seed: Pick<PlatformSeed, "tenants" | "requests" | "audit">, op: StaffMember): SupportData {
  return {
    tenants: seed.tenants.map(({ id, name }) => ({ id, name })),
    requests: seed.requests,
    audit: requireStaff(op, "audit.read") ? seed.audit.filter((e) => isSupportAction(e.action)).map(toLine) : null,
  }
}

