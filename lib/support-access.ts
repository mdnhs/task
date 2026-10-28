import type { Status } from "./types"

// Support access (FR-SAAS-09/10): platform support requests access, the tenant's admin grants, declines or revokes it.
// One record list shared by the platform console and tenant settings, so a request filed on one side shows on the other.
// Features can't import each other, so the shared model lives here. Server-safe: the client store and hook are in hooks/use-support-access.ts.
export type SupportStatus = "requested" | "granted" | "expired" | "revoked"

export const SUPPORT_STATUS: Record<SupportStatus, Status> = {
  requested: { tone: "info", label: "Requested" },
  granted: { tone: "ok", label: "Granted" },
  expired: { tone: "mute", label: "Expired" },
  revoked: { tone: "bad", label: "Revoked" },
}

export type SupportAccess = {
  id: string
  tenantId: string
  requester: string
  reason: string
  status: SupportStatus
  requestedAt: string
  expiresAt: string | null
  grantedBy: string | null
}

/** Mock clock helper: whole seconds since epoch for a YYYY-MM-DDTHH:mm[:ss] tenant-time string. */
export function isoSeconds(iso: string): number {
  const [y, mo, d, h = 0, mi = 0, s = 0] = iso.split(/[-T:]/).map((n) => parseInt(n, 10))
  return Date.UTC(y, mo - 1, d, h, mi, s) / 1000
}

/** A granted request whose expiry has passed reads as expired. */
export function effectiveStatus(r: SupportAccess, nowSeconds: number): SupportStatus {
  return r.status === "granted" && r.expiresAt && isoSeconds(r.expiresAt) <= nowSeconds ? "expired" : r.status
}

// Table order on the tenant side: requests waiting for a decision first, then open grants, then history.
const ORDER: Record<SupportStatus, number> = { requested: 0, granted: 1, expired: 2, revoked: 3 }

/** Rows with their status at `today`, sorted for the tenant table. Shared by PrivacyPanel and its skeleton. */
export function supportRows(list: SupportAccess[], today: string): { row: SupportAccess; status: SupportStatus }[] {
  const now = isoSeconds(today)
  return list
    .map((row) => ({ row, status: effectiveStatus(row, now) }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.row.requestedAt.localeCompare(a.row.requestedAt))
}

/** Adds seed rows the store doesn't hold yet (by id); edits made on either side are kept. */
export function mergeSupport(prev: SupportAccess[], rows: SupportAccess[]): SupportAccess[] {
  const have = new Set(prev.map((r) => r.id))
  const add = rows.filter((r) => !have.has(r.id))
  return add.length ? [...prev, ...add] : prev
}
