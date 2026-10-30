import { formatDate } from "@/lib/dates"
import { PLATFORM_LOCALE, REASON_MIN } from "./constants"
import { TENANT_STATUS } from "./types"
import type { AuditEntry, DataRequest, Health, Plan, PlatformTenant, StaffRole, SubEvent, TenantSort, TenantSortKey, TenantStatus, TenantView } from "./types"

/** Org "now" as a wall-clock ISO string, e.g. 2026-10-20T09:00:00. */
export const nowIso = (today: string) => `${today.slice(0, 10)}T${today.slice(11, 16)}:00`

export const planOf = (plans: Plan[], id: string) => plans.find((p) => p.id === id)

/** Monthly recurring revenue: trials and suspended tenants don't pay; past-due ones still count until they are suspended. */
export function tenantMrr(t: Pick<PlatformTenant, "status" | "plan">, plans: Plan[]): number {
  return t.status === "active" || t.status === "past_due" ? (planOf(plans, t.plan)?.priceMonthly ?? 0) : 0
}

export function summarize(tenants: PlatformTenant[], plans: Plan[]) {
  return {
    tenants: tenants.length,
    mrr: tenants.reduce((s, t) => s + tenantMrr(t, plans), 0),
    trials: tenants.filter((t) => t.status === "trial").length,
    pastDue: tenants.filter((t) => t.status === "past_due").length,
  }
}

export type TenantFilters = { q: string; status: "all" | TenantStatus; plan: string; view: TenantView }
export const EMPTY_FILTERS: TenantFilters = { q: "", status: "all", plan: "all", view: "all" }

/** Saved views (FilterSeg presets, D6), in display order. */
export const TENANT_VIEWS: { value: TenantView; label: string }[] = [
  { value: "all", label: "All" },
  { value: "trial", label: "Trials" },
  { value: "past_due", label: "Past due" },
  { value: "at_risk", label: "At risk" },
  { value: "suspended", label: "Suspended" },
]
export const isTenantView = (v: unknown): v is TenantView => TENANT_VIEWS.some((x) => x.value === v)

type ViewRow = Pick<PlatformTenant, "status"> & { health?: Pick<Health, "band"> }
/** At risk follows the health band (D5); the other views follow the status. */
export function inView(t: ViewRow, view: TenantView): boolean {
  if (view === "all") return true
  if (view === "at_risk") return t.health?.band === "at_risk"
  return t.status === view
}

export const viewCounts = (rows: ViewRow[]) =>
  Object.fromEntries(TENANT_VIEWS.map((v) => [v.value, rows.filter((r) => inView(r, v.value)).length])) as Record<TenantView, number>

/** Search covers the name, slug, subdomain and tenant id. */
export function filterTenants<T extends Pick<PlatformTenant, "id" | "name" | "slug" | "subdomain" | "status" | "plan"> & ViewRow>(tenants: T[], f: TenantFilters): T[] {
  const q = f.q.trim().toLowerCase()
  return tenants.filter(
    (t) =>
      inView(t, f.view) &&
      (f.status === "all" || t.status === f.status) &&
      (f.plan === "all" || t.plan === f.plan) &&
      (!q || [t.name, t.slug, t.subdomain, t.id].some((s) => s.toLowerCase().includes(q))),
  )
}

export const DEFAULT_SORT: TenantSort = { key: "name", dir: "asc" }
const STATUS_ORDER = Object.keys(TENANT_STATUS) as TenantStatus[]
const byName = new Intl.Collator(PLATFORM_LOCALE, { sensitivity: "base", numeric: true })

type SortRow = Pick<PlatformTenant, "name" | "plan" | "status" | "users" | "storageGb" | "createdAt"> & {
  mrr: number | null
  health: Pick<Health, "score">
  /** Position of the plan in the plans list (cheapest first); without it plans sort by id. */
  planRank?: number
}
const SORT_VALUE: Record<TenantSortKey, (r: SortRow) => number | string> = {
  name: (r) => r.name,
  plan: (r) => r.planRank ?? r.plan,
  status: (r) => STATUS_ORDER.indexOf(r.status),
  users: (r) => r.users,
  storage: (r) => r.storageGb,
  mrr: (r) => r.mrr ?? 0,
  health: (r) => r.health.score,
  created: (r) => r.createdAt,
}

/** A sorted copy. Ties always fall back to name A-Z, whichever way the column runs. */
export function sortTenants<R extends SortRow>(rows: R[], s: TenantSort): R[] {
  const get = SORT_VALUE[s.key]
  const sign = s.dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = get(a)
    const y = get(b)
    const c = typeof x === "number" && typeof y === "number" ? x - y : byName.compare(String(x), String(y))
    return c !== 0 ? c * sign : byName.compare(a.name, b.name)
  })
}

export const canSuspend = (t: PlatformTenant) => t.status !== "suspended"

/** Records the status it interrupts, so reactivate can return to it. The subscription itself is untouched. */
export function suspendTenant<T extends Pick<PlatformTenant, "status" | "statusBeforeSuspend">>(t: T, at: string, reason: string): T & { suspendedAt: string; suspendReason: string } {
  const before = t.status === "suspended" ? t.statusBeforeSuspend : t.status
  return { ...t, status: "suspended", suspendedAt: at, suspendReason: reason, ...(before ? { statusBeforeSuspend: before } : {}) }
}

/**
 * Back to the status the suspend interrupted (trial, active or past due: Review Focus 5). Seed suspensions don't record
 * it: then a tenant that was still trialling resumes as a trial, any other as active.
 */
export function reactivateTenant(t: PlatformTenant): PlatformTenant {
  const status = t.statusBeforeSuspend ?? (t.billing.trialEndsOn && !t.billing.renewsOn ? "trial" : "active")
  const rest: PlatformTenant = { ...t, status }
  delete rest.suspendedAt
  delete rest.suspendReason
  delete rest.statusBeforeSuspend
  return rest
}

export function nextId(prefix: string, ids: string[]): string {
  const max = ids.reduce((m, id) => Math.max(m, parseInt(id.replace(/\D/g, ""), 10) || 0), 0)
  return `${prefix}-${max + 1}`
}

export function auditEntry(entries: AuditEntry[], at: string, actor: string, action: string, target: string, detail: string): AuditEntry {
  return { id: nextId("PAU", entries.map((e) => e.id)), at, actor, action, target, detail }
}

/** D7: a sensitive action's audit entry, with the staff role, the change and the required reason. */
export function sensitiveEntry(
  entries: AuditEntry[],
  e: { at: string; actor: string; staffRole: StaffRole; tenantId?: string; action: string; target: string; detail: string; before: Record<string, unknown>; after: Record<string, unknown>; reason: string },
): AuditEntry {
  const reason = requireReason(e.reason)
  return {
    ...auditEntry(entries, e.at, e.actor, e.action, e.target, e.detail),
    ...(e.tenantId ? { tenantId: e.tenantId } : {}),
    staffRole: e.staffRole, before: e.before, after: e.after, reason,
  }
}

/** D7: the trimmed reason, or an error when it is shorter than REASON_MIN. */
export function requireReason(reason: string): string {
  const r = reason.trim()
  if (r.length < REASON_MIN) throw new Error(`A reason of at least ${REASON_MIN} characters is required`)
  return r
}

/** Audit log filters (all optional, ANDed). `from`/`to`: inclusive YYYY-MM-DD on the platform clock (`at` is wall-clock). */
export type AuditFilters = { tenantId?: string; name?: string; actor?: string; action?: string; from?: string; to?: string }

/**
 * Audit lines matching every given filter. Tenant: lines written since Task 5 carry `tenantId`; older ones only name the
 * tenant in `target`, so without a tenantId the name decides. Actor and action match exactly (the log's own values).
 */
export function filterAudit(entries: AuditEntry[], f: AuditFilters): AuditEntry[] {
  return entries.filter((e) => {
    if (f.tenantId && !(e.tenantId ? e.tenantId === f.tenantId : f.name !== undefined && e.target === f.name)) return false
    if (f.actor && e.actor !== f.actor) return false
    if (f.action && e.action !== f.action) return false
    const day = e.at.slice(0, 10)
    if (f.from && day < f.from) return false
    if (f.to && day > f.to) return false
    return true
  })
}

// ---------- Tenant 360 actions (Task 5) ----------
// Pure: each returns the changed tenant (and, where revenue moves, a SubEvent) and refuses what isn't allowed. The caller
// writes the store patch and a sensitiveEntry with before/after (D7).

/** YYYY-MM-DD plus whole days (calendar arithmetic, no time zone involved). Takes a date or a wall-clock ISO. */
export function addDaysToDate(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const paying = (s: TenantStatus) => s === "active" || s === "past_due"

/**
 * Moves the tenant to another plan now. A paying tenant (active, past due) gets an upgrade or downgrade SubEvent whose
 * mrrDelta is the MRR change, so the metrics (D4) follow; a trial has no revenue to move. Refuses the same plan and a
 * suspended tenant (reactivate first).
 */
export function changePlan(t: PlatformTenant, to: Plan, at: string, reason: string, ctx: { plans: Plan[]; events: Pick<SubEvent, "id">[] }): { tenant: PlatformTenant; event: SubEvent | null } {
  requireReason(reason)
  if (to.id === t.plan) throw new Error("The tenant is already on this plan")
  if (to.archived) throw new Error("That plan is archived and can't be chosen")
  if (t.status === "suspended") throw new Error("Reactivate the tenant before changing its plan")
  const tenant = { ...t, plan: to.id }
  if (!paying(t.status)) return { tenant, event: null }
  const from = planOf(ctx.plans, t.plan)
  const mrrDelta = tenantMrr(tenant, ctx.plans) - tenantMrr(t, ctx.plans)
  const up = mrrDelta !== 0 ? mrrDelta > 0 : ctx.plans.indexOf(to) > (from ? ctx.plans.indexOf(from) : -1)
  return { tenant, event: { id: nextId("SUB", ctx.events.map((e) => e.id)), tenantId: t.id, at, kind: up ? "upgrade" : "downgrade", plan: to.id, mrrDelta } }
}

/** The longest single trial extension. */
export const TRIAL_EXTENSION_MAX = 30

export function extendTrial(t: PlatformTenant, days: number, reason: string): PlatformTenant {
  requireReason(reason)
  if (t.status !== "trial" || !t.billing.trialEndsOn) throw new Error("Only a tenant on a trial can have its trial extended")
  if (!Number.isInteger(days) || days < 1 || days > TRIAL_EXTENSION_MAX) throw new Error(`Extend by 1 to ${TRIAL_EXTENSION_MAX} days`)
  return { ...t, billing: { ...t.billing, trialEndsOn: addDaysToDate(t.billing.trialEndsOn, days) } }
}

/** Deletion runs `retentionDays` (platform settings) after today, giving the tenant time to export or object. */
export function scheduleDeletion(t: PlatformTenant, today: string, retentionDays: number, reason: string): PlatformTenant {
  requireReason(reason)
  if (t.deletionAt) throw new Error("A deletion is already scheduled")
  return { ...t, deletionAt: addDaysToDate(today, retentionDays) }
}

export function cancelDeletion(t: PlatformTenant, reason: string): PlatformTenant {
  requireReason(reason)
  const rest = { ...t }
  delete rest.deletionAt
  return rest
}

/** The largest single credit, a guard against typos (plan currency). */
export const CREDIT_MAX = 10000

export function applyCredit(t: PlatformTenant, amount: number, reason: string): PlatformTenant {
  requireReason(reason)
  if (!Number.isFinite(amount) || amount <= 0 || amount > CREDIT_MAX) throw new Error(`Enter an amount above 0 and up to ${CREDIT_MAX}`)
  return { ...t, creditBalance: Math.round(((t.creditBalance ?? 0) + amount) * 100) / 100 }
}

/** Only a paid subscription has a period end to stop at. */
export const canCancelAtPeriodEnd = (t: Pick<PlatformTenant, "status" | "billing">) => paying(t.status) && !!t.billing.renewsOn

export function setCancelAtPeriodEnd(t: PlatformTenant, on: boolean, reason: string): PlatformTenant {
  requireReason(reason)
  if (on && !canCancelAtPeriodEnd(t)) throw new Error("Only a paid subscription with a renewal date can be cancelled at period end")
  if (on) return { ...t, cancelAtPeriodEnd: true }
  const rest = { ...t }
  delete rest.cancelAtPeriodEnd
  return rest
}

/**
 * Grants an add-on the plan lacks, revokes one it has, or (mode null) clears the module's override so the plan decides
 * again. `inPlan`: whether the tenant's plan includes the module. A core module is never revoked. The result feeds
 * lib/entitlements.ts (effectiveModules).
 */
export function overrideModule(
  t: PlatformTenant,
  module: string,
  mode: "grant" | "revoke" | null,
  inPlan: boolean,
  o: { at: string; by: string; reason: string; /** Core product modules (entitlements `core`): never revoked. */ core?: readonly string[] },
): PlatformTenant {
  const reason = requireReason(o.reason)
  if (mode === "revoke" && o.core?.includes(module)) throw new Error("A core module can't be revoked")
  if (mode === "grant" && inPlan) throw new Error("The plan already includes this module")
  if (mode === "revoke" && !inPlan) throw new Error("The plan doesn't include this module")
  const rest = (t.moduleOverrides ?? []).filter((x) => x.module !== module)
  const next = mode ? [...rest, { module, mode, reason, at: o.at, by: o.by }] : rest
  const out: PlatformTenant = { ...t, moduleOverrides: next }
  if (!next.length) delete out.moduleOverrides
  return out
}

/** Slugs are the tenant's subdomain label: lowercase letters, digits and single hyphens, 3 to 32 characters. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$/

export function changeSlug(t: PlatformTenant, slug: string, taken: string[], reason: string): PlatformTenant {
  requireReason(reason)
  const next = slug.trim().toLowerCase()
  if (next === t.slug) throw new Error("That is the current slug")
  if (!SLUG_RE.test(next)) throw new Error("Use 3 to 32 lowercase letters, digits or single hyphens")
  if (taken.includes(next)) throw new Error("That slug is taken by another tenant")
  const subdomain = t.subdomain.startsWith(`${t.slug}.`) ? `${next}${t.subdomain.slice(t.slug.length)}` : t.subdomain
  return { ...t, slug: next, subdomain }
}

export const NOTE_MAX = 1000

export function addNote(t: PlatformTenant, text: string, at: string, by: string): PlatformTenant {
  const body = text.trim()
  if (!body || body.length > NOTE_MAX) throw new Error(`Write a note of up to ${NOTE_MAX} characters`)
  const notes = t.notes ?? []
  return { ...t, notes: [...notes, { id: nextId("N", notes.map((n) => n.id)), at, by, text: body }] }
}

/** GDPR export of the whole workspace (FR-M0-19): due a month after the request (the queue is /platform/data-requests). */
export const EXPORT_DUE_DAYS = 30

export function exportRequest(t: PlatformTenant, o: { at: string; by: string; reason: string; ids: string[] }): DataRequest {
  const note = requireReason(o.reason)
  return {
    id: nextId("DSR", o.ids), tenantId: t.id, kind: "export", subject: "tenant", requestedBy: o.by, requestedAt: o.at,
    dueAt: `${addDaysToDate(o.at, EXPORT_DUE_DAYS)}${o.at.slice(10)}`, status: "received", note,
  }
}

/** Wall-clock ISO to seconds since epoch (timezone free, both sides use the same zone). */
export { effectiveStatus, isoSeconds } from "@/lib/support-access"

/** "1d 02:15:09" / "02:15:09" for the time left; null when it has run out. */
export function formatLeft(seconds: number): string | null {
  if (seconds <= 0) return null
  const pad = (n: number) => String(n).padStart(2, "0")
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${d ? `${d}d ` : ""}${pad(h)}:${pad(m)}:${pad(Math.floor(seconds % 60))}`
}



/** "Wed 12 Mar 2025": platform dates span years, so the year is shown. */
export const dateY = (iso: string) => `${formatDate(iso)} ${iso.slice(0, 4)}`

/** Field labels of the plan edit form (shared with its skeleton, so the ghost text is the real text). */
export const priceLabel = (currency: string) => `Price per month (${currency})`
export const limitLabel = (l: { label: string; unit: string }) => `${l.label}${l.unit ? ` (${l.unit})` : ""}`
