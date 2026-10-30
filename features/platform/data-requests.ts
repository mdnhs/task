import { daysBetween } from "@/lib/dates"
import type { Status } from "@/lib/types"
import { PLATFORM_LOCALE } from "./constants"
import { dateY, requireReason } from "./logic"
import type { DataRequest, DataRequestStatus, PlatformSeed, PlatformTenant } from "./types"

// The data requests queue (Task 8, FR-M0-19, FR-SAAS-15): GDPR export, deletion and correction requests with a 30-day SLA.
// Pure logic and the server view model. Privacy (D8): only request metadata is handled here, never the person's data.

/** The SLA: a request is due 30 days after it was received (`dueAt` in the data). The countdown turns red under this many days. */
export const URGENT_DAYS = 7

export type DataKind = DataRequest["kind"]
export const KIND_LABEL: Record<DataKind, string> = { export: "Export", deletion: "Deletion", correction: "Correction" }
export const SUBJECT_LABEL: Record<DataRequest["subject"], string> = { tenant: "Tenant workspace", person: "Individual" }
export const STATUS_LABEL: Record<DataRequestStatus, string> = { received: "Received", in_progress: "In progress", completed: "Completed", rejected: "Rejected" }

export const isOpen = (r: Pick<DataRequest, "status">) => r.status === "received" || r.status === "in_progress"

/** Whole calendar days from today to the due date: 0 is due today, negative is overdue. */
export const dueIn = (r: Pick<DataRequest, "dueAt">, today: string): number => daysBetween(r.dueAt, today)

/** The countdown shown in the queue: `urgent` under 7 days (red) and when overdue. Null on a closed request. */
export function dueLabel(r: Pick<DataRequest, "dueAt" | "status">, today: string): { text: string; urgent: boolean } | null {
  if (!isOpen(r)) return null
  const d = dueIn(r, today)
  const n = (x: number) => `${x} day${x === 1 ? "" : "s"}`
  const text = d < 0 ? `${n(-d)} overdue` : d === 0 ? "Due today" : `${n(d)} left`
  return { text, urgent: d < URGENT_DAYS }
}

// ---------- Status transitions ----------
const NEXT: Record<DataRequestStatus, DataRequestStatus[]> = {
  received: ["in_progress", "rejected"],
  in_progress: ["completed", "rejected"],
  completed: [],
  rejected: [],
}
export const nextStatuses = (s: DataRequestStatus): DataRequestStatus[] => NEXT[s]

/**
 * Why a request can't be completed yet, or null. A tenant-workspace deletion may only complete once the tenant's scheduled
 * `deletionAt` has passed (the retention period gives the tenant time to export or object). Exports, corrections and a
 * single person's deletion don't depend on the workspace's date.
 */
export function completeBlock(r: Pick<DataRequest, "kind" | "subject">, deletionAt: string | undefined, today: string): string | null {
  if (r.kind !== "deletion" || r.subject !== "tenant") return null
  if (!deletionAt) return "Schedule the tenant's deletion first (Tenant 360, Settings)."
  if (daysBetween(deletionAt, today) > 0) return `Deletion is scheduled for ${dateY(deletionAt)}. Complete it after that date.`
  return null
}

/**
 * The request after a transition. Completing needs a note ("export ready") and rejecting a reason, both 10+ characters
 * (`text`); starting needs none. `deletionAt`: the tenant's scheduled deletion date, for completeBlock.
 */
export function transition(r: DataRequest, to: DataRequestStatus, o: { at: string; by: string; text?: string; deletionAt?: string }): DataRequest {
  if (!NEXT[r.status].includes(to)) throw new Error(`A request that is ${STATUS_LABEL[r.status].toLowerCase()} can't move to ${STATUS_LABEL[to].toLowerCase()}`)
  if (to === "in_progress") return { ...r, status: to }
  const text = requireReason(o.text ?? "")
  if (to === "completed") {
    const block = completeBlock(r, o.deletionAt, o.at)
    if (block) throw new Error(block)
  }
  return { ...r, status: to, resolution: text, closedAt: o.at, closedBy: o.by }
}

// ---------- Queue ----------
/** The audit line's content for a status change (the view adds actor, time and id). Starting is a plain line with any
 *  note in the detail; completing or rejecting is sensitive (D7), and its text goes only in `reason`, not the detail too. */
export type TransitionAudit = { action: string; detail: string; sensitive: boolean; reason?: string; before: Record<string, unknown>; after: Record<string, unknown> }
export function transitionAudit(r: DataRequest, next: DataRequest, to: DataRequestStatus, text?: string): TransitionAudit {
  const verb = to === "in_progress" ? "started" : to
  const head = `${KIND_LABEL[r.kind]} request ${r.id} ${verb}`
  const change = { before: { status: r.status }, after: { status: next.status, ...(next.resolution ? { resolution: next.resolution } : {}) } }
  return to === "in_progress"
    ? { action: `data_request.${verb}`, detail: text ? `${head}: ${text}` : head, sensitive: false, ...change }
    : { action: `data_request.${verb}`, detail: head, sensitive: true, reason: text ?? "", ...change }
}

export type DataView = "open" | "due_soon" | "completed" | "rejected" | "all"
export const DR_VIEWS: { value: DataView; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "due_soon", label: "Due soon" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
]
export const isDataView = (v: unknown): v is DataView => DR_VIEWS.some((x) => x.value === v)

type Row = Pick<DataRequest, "id" | "tenantId" | "kind" | "subject" | "requestedBy" | "requestedAt" | "dueAt" | "status">
const inView = (r: Row, v: DataView, today: string) =>
  v === "all" ? true : v === "open" ? isOpen(r) : v === "due_soon" ? isOpen(r) && dueIn(r, today) < URGENT_DAYS : r.status === v

export const dataViewCounts = (rows: Row[], today: string) =>
  Object.fromEntries(DR_VIEWS.map((v) => [v.value, rows.filter((r) => inView(r, v.value, today)).length])) as Record<DataView, number>

/** Search covers the id, requester, tenant name and the kind. */
export function filterRequests<R extends Row>(rows: R[], f: { view: DataView; q: string }, today: string, names: Map<string, string> = new Map()): R[] {
  const q = f.q.trim().toLowerCase()
  return rows.filter((r) => inView(r, f.view, today) && (!q || [r.id, r.requestedBy, names.get(r.tenantId) ?? "", KIND_LABEL[r.kind]].some((s) => s.toLowerCase().includes(q))))
}

export type DataSortKey = "type" | "tenant" | "requested" | "due" | "status"
export type DataSort = { key: DataSortKey; dir: "asc" | "desc" }
export const DEFAULT_DATA_SORT: DataSort = { key: "due", dir: "asc" }
const ORDER: DataRequestStatus[] = ["received", "in_progress", "completed", "rejected"]
const collator = new Intl.Collator(PLATFORM_LOCALE, { sensitivity: "base", numeric: true })

/** A sorted copy; ties fall back to the request id. */
export function sortRequests<R extends Row>(rows: R[], s: DataSort, names: Map<string, string>): R[] {
  const get = (r: R): number | string =>
    s.key === "type" ? KIND_LABEL[r.kind] : s.key === "tenant" ? (names.get(r.tenantId) ?? r.tenantId) : s.key === "requested" ? r.requestedAt : s.key === "due" ? r.dueAt : ORDER.indexOf(r.status)
  const sign = s.dir === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = get(a)
    const y = get(b)
    const c = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y))
    return c !== 0 ? c * sign : collator.compare(a.id, b.id)
  })
}

// ---------- Server view model (D8: slim) ----------
export type DataRequestsData = {
  requests: DataRequest[]
  /** Names and deletion dates only: the queue never needs the rest of a tenant record. */
  tenants: Pick<PlatformTenant, "id" | "name" | "deletionAt">[]
}

export function dataRequestsData(seed: Pick<PlatformSeed, "tenants" | "dataRequests">): DataRequestsData {
  return {
    requests: seed.dataRequests,
    tenants: seed.tenants.map((t) => ({ id: t.id, name: t.name, ...(t.deletionAt ? { deletionAt: t.deletionAt } : {}) })),
  }
}

export const DR_STATUS: Record<DataRequestStatus, Status> = {
  received: { tone: "info", label: "Received" },
  in_progress: { tone: "warn", label: "In progress" },
  completed: { tone: "ok", label: "Completed" },
  rejected: { tone: "mute", label: "Rejected" },
}
