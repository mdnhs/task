"use client"

import { useMemo, useSyncExternalStore } from "react"

import { useSupportAccess } from "@/hooks/use-support-access"
import type { InvoiceRow } from "../../billing"
import { withoutAmounts } from "../../tenant-360"
import { auditEntry, filterAudit, nowIso, sensitiveEntry } from "../../logic"
import { applyPatch, applyPatches, foldAudit, mergePatch, tenantDiff } from "../../patches"
import {
  auditOutbox, auditStore, dataRequestOutbox, dataRequestsStore, invoicesStore, subEventOutbox, subscriptionsStore, tenantPatchStore,
  tenantsStore, useDataRequestOutbox, useInvoicePatches, useOutbox, usePatches,
} from "../../store"
import type { AuditEntry, DataRequest, PlatformTenant, StaffRole, SubEvent, SupportRequest } from "../../types"

// The tenant 360 follows the store patch contract (store.ts): it renders its server record overlaid by the full tenants
// store (when a full page already loaded it) and then by the patches, and writes only patches and outboxes. So the
// header, every tab, the tenants list and the other console pages show the same live state after client navigation.

export type Operator = { name: string; role: StaffRole }
export type T360Ctx = { operator: Operator; today: string; tzLabel: string }

const noStore = () => undefined

/** The live tenant: server record ← full store record (if any) ← this session's patch. `amounts` = billing.read. */
export function useLiveTenant(server: PlatformTenant, amounts: boolean): PlatformTenant {
  const full = useSyncExternalStore(tenantsStore.subscribe, tenantsStore.get, noStore)
  const patches = usePatches()
  return useMemo(() => {
    const f = full?.find((t) => t.id === server.id)
    const live = applyPatch(f ?? server, patches[server.id])
    return amounts ? live : withoutAmounts(live)
  }, [full, patches, server, amounts])
}

/** Live invoices (billing ledger contract): server rows ← full invoices store ← invoice patches. */
export function useLiveInvoices(rows: InvoiceRow[]): InvoiceRow[] {
  const full = useSyncExternalStore(invoicesStore.subscribe, invoicesStore.get, noStore)
  const patches = useInvoicePatches()
  return useMemo(() => {
    const byId = new Map((full ?? []).map((i) => [i.id, i]))
    const base = rows.map((i) => {
      const f = byId.get(i.id)
      return f ? { ...i, status: f.status, attempts: f.attempts, nextRetryAt: f.nextRetryAt, events: f.events } : i
    })
    return applyPatches(base, patches)
  }, [rows, full, patches])
}

/** This tenant's audit lines, newest first: the full log if a full page loaded it, else the server slice, plus the outbox. */
export function useLiveAudit(server: AuditEntry[], tenant: Pick<PlatformTenant, "id" | "name">): AuditEntry[] {
  const full = useSyncExternalStore(auditStore.subscribe, auditStore.get, noStore)
  const outbox = useOutbox()
  return useMemo(() => {
    const merged = foldAudit(full ?? server, outbox)
    return filterAudit(merged, { tenantId: tenant.id, name: tenant.name })
  }, [full, server, outbox, tenant.id, tenant.name])
}

/** This tenant's data requests: the full queue if loaded, else the server slice, plus the ones filed here. */
export function useLiveDataRequests(server: DataRequest[], tenantId: string): DataRequest[] {
  const full = useSyncExternalStore(dataRequestsStore.subscribe, dataRequestsStore.get, noStore)
  const filed = useDataRequestOutbox()
  return useMemo(
    () => [...filed, ...(full ?? server)].filter((r) => r.tenantId === tenantId && r.subject === "tenant"),
    [filed, full, server, tenantId],
  )
}

/** Support requests are one shared store with the tenant app (lib/support-access.ts); seeded from this tenant's slice. */
export function useTenantRequests(server: SupportRequest[], tenantId: string): SupportRequest[] {
  const [all] = useSupportAccess(server)
  return useMemo(() => all.filter((r) => r.tenantId === tenantId).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)), [all, tenantId])
}

/** Ids known on the client for a prefix: the platform-wide floor from the server, the store (if loaded) and the outbox. */
export function knownIds(floor: string, store: { id: string }[] | undefined, outbox: { id: string }[]): string[] {
  return [floor, ...(store ?? []).map((x) => x.id), ...outbox.map((x) => x.id)]
}

/**
 * Writes one tenant 360 action: the tenant patch (only what changed), the D7 audit line with before/after and the
 * reason, and, when given, a subscription event or a data request. `reason` undefined = not a D7 action (a note, a
 * retry): the line still records the staff role and the change.
 */
export function commitTenant(
  ctx: T360Ctx,
  before: PlatformTenant,
  after: PlatformTenant,
  a: { action: string; detail: string; reason?: string; event?: SubEvent | null; request?: DataRequest },
) {
  const at = nowIso(ctx.today)
  const { patch, before: was, after: now } = tenantDiff(before, after)
  if (Object.keys(patch).length) tenantPatchStore.set((all) => ({ ...all, [before.id]: mergePatch(all[before.id], patch) }))
  const known = [...(auditStore.get() ?? []), ...(auditOutbox.get() ?? [])]
  const entry: AuditEntry =
    a.reason !== undefined
      ? sensitiveEntry(known, { at, actor: ctx.operator.name, staffRole: ctx.operator.role, tenantId: before.id, action: a.action, target: before.name, detail: a.detail, before: was, after: now, reason: a.reason })
      : { ...auditEntry(known, at, ctx.operator.name, a.action, before.name, a.detail), tenantId: before.id, staffRole: ctx.operator.role, before: was, after: now }
  auditOutbox.set((list) => [entry, ...list])
  if (a.event) subEventOutbox.set((list) => [...list, a.event!])
  if (a.request) dataRequestOutbox.set((list) => [a.request!, ...list])
}

/** Next ids for what the 360 files, numbered against everything the client knows (see knownIds). */
export const subIds = (floor: string) => knownIds(floor, subscriptionsStore.get(), subEventOutbox.get() ?? []).map((id) => ({ id }))
export const nextDsrIds = (floor: string) => knownIds(floor, dataRequestsStore.get(), dataRequestOutbox.get() ?? [])
