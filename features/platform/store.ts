import { useEffect } from "react"

import { createStore } from "@/lib/store"
import { useSupportAccess } from "@/hooks/use-support-access"
import type { EntitlementsData } from "@/lib/entitlements"
import { applyPatches, foldAudit, type DataRequestPatches, type InvoicePatches, type TenantPatches } from "./patches"
import type { AuditEntry, DataRequest, Invoice, Plan, PlatformSeed, PlatformSettings, PlatformTenant, StaffMember, SubEvent, UsagePoint } from "./types"

export const tenantsStore = createStore<PlatformTenant[]>()
export const plansStore = createStore<Plan[]>()
export const entitlementsStore = createStore<EntitlementsData>()
export { supportStore as requestsStore } from "@/hooks/use-support-access"
export const auditStore = createStore<AuditEntry[]>()

export const subscriptionsStore = createStore<SubEvent[]>()
export const invoicesStore = createStore<Invoice[]>()
export const usageStore = createStore<Record<string, UsagePoint[]>>()
export const dataRequestsStore = createStore<DataRequest[]>()

export const SCOPE = "platform"

// Task 9: the team page and the settings page are the only readers and writers of these (each seeds from its own server
// data). Their audit lines go to auditOutbox like every other slim page.
export const staffStore = createStore<StaffMember[]>()
export const settingsStore = createStore<PlatformSettings>()

// Patch model (Task 4 review). Pages that get only slim rows (the tenants list: no contacts, billing or audit log in its
// payload) never write tenantsStore or auditStore. They write:
//   - tenantPatchStore: { [tenantId]: TenantPatch } (status / suspendedAt / suspendReason; undefined = remove the field);
//   - auditOutbox: new audit entries (their ids are re-numbered when folded in).
// Contract for full-record pages (tenant 360, Task 5, and anything on usePlatform): render applyPatches(tenants, patches)
// and foldAudit(audit, outbox) over your own server data, then fold both into the full stores and clear them (usePlatform
// does this in an effect). Slim pages read tenantsStore only as an overlay (if a full page already loaded it) and then
// apply their own patches on top. Patches always win: they are the newest edit.
export const tenantPatchStore = createStore<TenantPatches>()
// The billing ledger (Task 6) follows the same contract for invoices: invoicePatchStore + auditOutbox.
export const invoicePatchStore = createStore<InvoicePatches>()
export const auditOutbox = createStore<AuditEntry[]>()
// The data requests queue (Task 8) records status changes the same way: dataRequestPatchStore + auditOutbox.
export const dataRequestPatchStore = createStore<DataRequestPatches>()
// The tenant 360 (Task 5) also records new subscription events (plan changes) and data requests (export tenant data).
// Their ids are numbered against the platform-wide highest id the 360's server data carries, so they are final.
export const subEventOutbox = createStore<SubEvent[]>()
export const dataRequestOutbox = createStore<DataRequest[]>()

/** Every audit line this session knows (the full store, if a page loaded it, plus the outbox): the id pool new lines count from. */
export const knownAudit = (): AuditEntry[] => [...(auditStore.get() ?? []), ...(auditOutbox.get() ?? [])]

// Seeded empty up front, so a slim page can write before any full page has loaded. Only client handlers ever write them.
const NO_PATCHES: TenantPatches = {}
const NO_INVOICE_PATCHES: InvoicePatches = {}
const NO_ENTRIES: AuditEntry[] = []
tenantPatchStore.seed(NO_PATCHES)
invoicePatchStore.seed(NO_INVOICE_PATCHES)
const NO_REQUEST_PATCHES: DataRequestPatches = {}
dataRequestPatchStore.seed(NO_REQUEST_PATCHES)
auditOutbox.seed(NO_ENTRIES)
const NO_EVENTS: SubEvent[] = []
const NO_REQUESTS: DataRequest[] = []
subEventOutbox.seed(NO_EVENTS)
dataRequestOutbox.seed(NO_REQUESTS)
/** Stable empty values for useStore (a fresh {} per render would be a new server snapshot each time). */
export const usePatches = () => tenantPatchStore.useStore(NO_PATCHES)[0]
export const useOutbox = () => auditOutbox.useStore(NO_ENTRIES)[0]
export const useInvoicePatches = () => invoicePatchStore.useStore(NO_INVOICE_PATCHES)[0]
export const useDataRequestPatches = () => dataRequestPatchStore.useStore(NO_REQUEST_PATCHES)[0]
export const useSubEventOutbox = () => subEventOutbox.useStore(NO_EVENTS)[0]
export const useDataRequestOutbox = () => dataRequestOutbox.useStore(NO_REQUESTS)[0]

/**
 * Moves everything slim pages wrote (patches and outboxes) into the full stores, once. Each box is read from its store at
 * call time and cleared before it is folded, so calling this again (React StrictMode runs mount effects twice with the
 * same closure) finds the boxes empty and adds nothing: no audit line, sub event or data request is folded twice.
 * A box stays put while its full store isn't seeded yet, so nothing is lost before a full page has loaded.
 */
export function foldPending() {
  const take = <T,>(box: { get(): T | undefined; set(u: (p: T) => T): void }, empty: T, isEmpty: (v: T) => boolean): T | null => {
    const v = box.get()
    if (v === undefined || isEmpty(v)) return null
    box.set(() => empty)
    return v
  }
  const noKeys = (o: object) => Object.keys(o).length === 0
  const none = (a: unknown[]) => a.length === 0
  if (tenantsStore.get() !== undefined) {
    const p = take(tenantPatchStore, NO_PATCHES, noKeys)
    if (p) tenantsStore.set((all) => applyPatches(all, p))
  }
  if (auditStore.get() !== undefined) {
    const box = take(auditOutbox, NO_ENTRIES, none)
    if (box) auditStore.set((all) => foldAudit(all, box))
  }
  if (invoicesStore.get() !== undefined) {
    const p = take(invoicePatchStore, NO_INVOICE_PATCHES, noKeys)
    if (p) invoicesStore.set((all) => applyPatches(all, p))
  }
  if (subscriptionsStore.get() !== undefined) {
    const box = take(subEventOutbox, NO_EVENTS, none)
    // De-dupe by id as well: an event already in the store is never appended again.
    if (box) subscriptionsStore.set((all) => [...all, ...box.filter((e) => !all.some((x) => x.id === e.id))])
  }
  if (dataRequestsStore.get() !== undefined) {
    const box = take(dataRequestOutbox, NO_REQUESTS, none)
    if (box) dataRequestsStore.set((all) => [...box.filter((r) => !all.some((x) => x.id === r.id)), ...all])
    const p = take(dataRequestPatchStore, NO_REQUEST_PATCHES, noKeys)
    if (p) dataRequestsStore.set((all) => applyPatches(all, p))
  }
}

// Every platform page seeds every store, so an edit on one page shows up on the others after client navigation.
export function usePlatform(seed: PlatformSeed) {
  const [tenants, setTenants] = tenantsStore.useStore(seed.tenants, SCOPE)
  const [plans, setPlans] = plansStore.useStore(seed.plans, SCOPE)
  const [entitlements, setEntitlements] = entitlementsStore.useStore(seed.entitlements, SCOPE)
  const [requests, setRequests] = useSupportAccess(seed.requests)
  const [audit, setAudit] = auditStore.useStore(seed.audit, SCOPE)
  const [subscriptions, setSubscriptions] = subscriptionsStore.useStore(seed.subscriptions, SCOPE)
  const [invoices, setInvoices] = invoicesStore.useStore(seed.invoices, SCOPE)
  const [usage, setUsage] = usageStore.useStore(seed.usage, SCOPE)
  const [dataRequests, setDataRequests] = dataRequestsStore.useStore(seed.dataRequests, SCOPE)
  const patches = usePatches()
  const outbox = useOutbox()
  const invoicePatches = useInvoicePatches()
  const newEvents = useSubEventOutbox()
  const newRequests = useDataRequestOutbox()
  const requestPatches = useDataRequestPatches()
  // Fold what slim pages wrote into the full stores once, then clear it (see the patch model above). The deps only
  // re-run it; foldPending reads the stores itself, so a second run with the same values (StrictMode) folds nothing.
  useEffect(() => {
    foldPending()
  }, [patches, outbox, invoicePatches, newEvents, newRequests, requestPatches])
  return {
    subscriptions: newEvents.length ? [...subscriptions, ...newEvents] : subscriptions, setSubscriptions, invoices: applyPatches(invoices, invoicePatches), setInvoices, usage, setUsage,
    dataRequests: applyPatches(newRequests.length ? [...newRequests, ...dataRequests] : dataRequests, requestPatches), setDataRequests, tenants: applyPatches(tenants, patches), setTenants, plans, setPlans, entitlements, setEntitlements, requests, setRequests, audit: outbox.length ? foldAudit(audit, outbox) : audit, setAudit }
}
