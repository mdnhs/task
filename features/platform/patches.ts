import { nextId } from "./logic"
import type { AuditEntry, DataRequest, Invoice, PlatformTenant } from "./types"

// Store patch model (pure part; the stores are in store.ts). A page that holds only slim tenant rows (the tenants list)
// never writes full records: it records a patch per tenant and pushes new audit entries to an outbox. A page that holds
// the full records (foldPending) applies both over its own server data and then clears them.

/**
 * The fields a page may change on a tenant: the tenants list writes the suspend fields, the tenant 360 (Task 5) the rest.
 * `undefined` = remove the field (reactivate clears the suspend fields).
 */
export const TENANT_PATCH_KEYS = [
  "status", "suspendedAt", "suspendReason", "statusBeforeSuspend", "plan", "slug", "subdomain", "billing", "moduleOverrides", "notes",
  "creditBalance", "cancelAtPeriodEnd", "deletionAt",
] as const satisfies readonly (keyof PlatformTenant)[]
export type TenantPatch = Partial<Pick<PlatformTenant, (typeof TENANT_PATCH_KEYS)[number]>>
export type TenantPatches = Record<string, TenantPatch>
/** Invoice changes from the billing ledger (Task 6): the fields its actions write (billing.ts). */
export type InvoicePatch = Partial<Pick<Invoice, "status" | "attempts" | "nextRetryAt" | "events">>
export type InvoicePatches = Record<string, InvoicePatch>
/** Data request changes from the queue (Task 8): the fields a transition writes (data-requests.ts). */
export type DataRequestPatch = Partial<Pick<DataRequest, "status" | "resolution" | "closedAt" | "closedBy">>
export type DataRequestPatches = Record<string, DataRequestPatch>

export function applyPatch<T extends { id: string }>(t: T, p: object | undefined): T {
  if (!p) return t
  const out: Record<string, unknown> = { ...t }
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) delete out[k]
    else out[k] = v
  }
  return out as T
}

export function applyPatches<T extends { id: string }>(rows: T[], patches: Record<string, object>): T[] {
  return Object.keys(patches).length ? rows.map((t) => applyPatch(t, patches[t.id])) : rows
}

/** Later patches win field by field. */
export const mergePatch = <P extends object>(prev: P | undefined, next: P): P => ({ ...prev, ...next })

/** Outbox entries join the log newest first, each re-numbered against the full log (the outbox didn't know its ids). */
export function foldAudit(audit: AuditEntry[], outbox: AuditEntry[]): AuditEntry[] {
  let all = audit
  for (const e of [...outbox].reverse()) all = [{ ...e, id: nextId("PAU", all.map((x) => x.id)) }, ...all]
  return all
}

/**
 * What an action changed on a tenant: the patch (removed fields as undefined) and the audit before/after of only those
 * fields (a removed field is null in `after`, since JSON has no undefined).
 */
export function tenantDiff(a: PlatformTenant, b: PlatformTenant): { patch: TenantPatch; before: Record<string, unknown>; after: Record<string, unknown> } {
  const patch: Record<string, unknown> = {}
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const k of TENANT_PATCH_KEYS) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue
    patch[k] = b[k]
    before[k] = a[k] ?? null
    after[k] = b[k] ?? null
  }
  return { patch: patch as TenantPatch, before, after }
}
