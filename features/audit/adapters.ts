// Audit log mapping and queries (B6 T6.5, B7 T9). The API filters by `entity`, `actorId`, `action`, `from` and `to` and pages newest first with a cursor (100 a page): those go in the query.
// Only the text search works on the loaded rows (and "System", which has no actor id). Dates are the tenant's calendar days, turned into instants in the tenant's zone.
import type { ApiClient } from "@/lib/api/client"
import { dayBoundsInTz, wallInTz } from "@/lib/tz"
import { actionInfo } from "./actions-catalogue"
import { SYSTEM_ACTOR } from "./filters"
import type { AuditEvent, AuditFilters } from "./types"

/** The API's page size (its maximum). */
export const AUDIT_LIMIT = 100

type Rec = Record<string, unknown>
const bad = (k: string, want: string): never => {
  throw new Error(`audit: ${k} must be ${want}`)
}

const MAX_VALUE = 200
/** Top-level scalar values of the before and after snapshots (after wins), as short text. Nested objects and arrays are not dumped into the table. */
function flatten(before: unknown, after: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const snap of [before, after]) {
    if (!snap || typeof snap !== "object" || Array.isArray(snap)) continue
    for (const [k, v] of Object.entries(snap as Rec)) {
      if (v === null || v === undefined || typeof v === "object") continue
      out[k] = String(v).slice(0, MAX_VALUE)
    }
  }
  return out
}

export function toAuditEvent(dto: unknown, tz: string, nameOf: (userId: string) => string): AuditEvent {
  const r = dto as Rec
  if (!r || typeof r !== "object") bad("row", "an object")
  const seq = Number.isInteger(r.seq) ? (r.seq as number) : bad("seq", "an integer")
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : bad(k, "a string"))
  const actorId = r.actorId === null ? null : str("actorId")
  const action = str("action")
  return {
    id: `AUD-${seq}`, seq, at: wallInTz(str("at"), tz), actorId, actor: actorId === null ? "System" : nameOf(actorId), action,
    recordType: str("entity"), recordRef: str("entityId"), sensitive: actionInfo(action).sensitive, meta: flatten(r.before, r.after),
  }
}

export type AuditQuery = { entity?: string; actorId?: string; action?: string; from?: string; to?: string; limit: number; cursor?: string }

/** The query the API understands. A bad or empty day is left out; "all" and "system" (no actor id) are not API filters. */
export function auditQuery(f: AuditFilters, tz: string, cursor?: string): AuditQuery {
  const entity = f.recordType !== "all" && f.recordType ? f.recordType : undefined
  const actorId = f.actor !== "all" && f.actor !== SYSTEM_ACTOR && f.actor ? f.actor : undefined
  const action = f.action !== "all" && f.action ? f.action : undefined
  const from = f.from ? dayBoundsInTz(f.from, tz).from : undefined
  const to = f.to ? dayBoundsInTz(f.to, tz).to : undefined
  // key order is part of the contract with the tests: entity, actorId, action, from, to, limit, cursor
  return {
    ...(entity ? { entity } : {}), ...(actorId ? { actorId } : {}), ...(action ? { action } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}),
    limit: AUDIT_LIMIT, ...(cursor ? { cursor } : {}),
  }
}

export type AuditPage = { events: AuditEvent[]; nextCursor: string | null }

/** One page of the log for these filters (newest first); pass the previous page's `nextCursor` for the next, older one. */
export async function loadAudit(api: Pick<ApiClient, "get">, f: AuditFilters, tz: string, nameOf: (userId: string) => string, cursor?: string): Promise<AuditPage> {
  const page = await api.get("/v1/audit", { query: auditQuery(f, tz, cursor) })
  return { events: page.items.map((r) => toAuditEvent(r, tz, nameOf)), nextCursor: page.nextCursor }
}

/** The CSV is the API's own download (streamed through the BFF with the session cookie; the API audits `audit.exported`). Every filter the API accepts goes in (not the text search). */
export function exportUrl(f: AuditFilters, tz: string): string {
  const q = auditQuery(f, tz)
  const p = new URLSearchParams({ format: "csv" })
  if (q.entity) p.set("entity", q.entity)
  if (q.actorId) p.set("actorId", q.actorId)
  if (q.action) p.set("action", q.action)
  if (q.from) p.set("from", q.from)
  if (q.to) p.set("to", q.to)
  return `/v1/audit/export?${p.toString()}`
}

/** Id -> name for the people the caller can see. Anyone else is "Unknown member" (never a raw id on screen). */
export const nameFrom = (names: Record<string, string>) => (id: string): string => names[id] ?? "Unknown member"
