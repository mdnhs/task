// Audit log mapping and queries (B6 T6.5). The API has `entity`, `from`, `to` and `limit` (max 1000, newest first): those go in the query. The actor, action and text
// filters work on the loaded page. Dates are the tenant's calendar days, turned into instants in the tenant's zone.
import type { ApiClient } from "@/lib/api/client"
import { dayBoundsInTz, wallInTz } from "@/lib/tz"
import { actionInfo } from "./actions-catalogue"
import type { AuditEvent, AuditFilters } from "./types"

export const AUDIT_LIMIT = 1000

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

export type AuditQuery = { entity?: string; from?: string; to?: string; limit: number }

/** The query the API understands. A bad or empty day is left out. */
export function auditQuery(f: AuditFilters, tz: string): AuditQuery {
  const q: AuditQuery = { limit: AUDIT_LIMIT }
  if (f.recordType !== "all" && f.recordType) q.entity = f.recordType
  if (f.from) q.from = dayBoundsInTz(f.from, tz).from
  if (f.to) q.to = dayBoundsInTz(f.to, tz).to
  // key order is part of the contract with the tests: entity, from, to, limit
  return { ...(q.entity ? { entity: q.entity } : {}), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}), limit: q.limit }
}

export async function loadAudit(api: Pick<ApiClient, "get">, f: AuditFilters, tz: string, nameOf: (userId: string) => string): Promise<AuditEvent[]> {
  const rows = await api.get("/v1/audit", { query: auditQuery(f, tz) })
  return rows.map((r) => toAuditEvent(r, tz, nameOf))
}

/** The CSV is the API's own download (streamed through the BFF with the session cookie; the API audits `audit.exported`). Only the filters the API accepts go in. */
export function exportUrl(f: AuditFilters, tz: string): string {
  const q = auditQuery(f, tz)
  const p = new URLSearchParams({ format: "csv" })
  if (q.entity) p.set("entity", q.entity)
  if (q.from) p.set("from", q.from)
  if (q.to) p.set("to", q.to)
  return `/v1/audit/export?${p.toString()}`
}

/** Id -> name for the people the caller can see. Anyone else is "Unknown member" (never a raw id on screen). */
export const nameFrom = (names: Record<string, string>) => (id: string): string => names[id] ?? "Unknown member"
