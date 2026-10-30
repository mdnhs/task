import { ACTION } from "./types"
import type { OutboxAuditEvent } from "@/lib/audit-outbox"
import type { AuditAction, AuditEvent, AuditFilters } from "./types"

export const AUDIT_PAGE_SIZE = 15
export const EMPTY_FILTERS: AuditFilters = { q: "", actor: "all", action: "all", recordType: "all", from: "", to: "" }

export function filterEvents(events: AuditEvent[], f: AuditFilters): AuditEvent[] {
  const q = f.q.trim().toLowerCase()
  return events.filter((e) => {
    const day = e.at.slice(0, 10)
    return (
      (f.actor === "all" || e.actor === f.actor) &&
      (f.action === "all" || e.action === f.action) &&
      (f.recordType === "all" || e.recordType === f.recordType) &&
      (!f.from || day >= f.from) &&
      (!f.to || day <= f.to) &&
      (!q || [e.id, e.actor, ACTION[e.action].label, e.recordType, e.recordRef, e.ip, e.device].some((s) => s.toLowerCase().includes(q)))
    )
  })
}

// A leading = + - @ (or tab/CR) would run as a formula in Excel; prefix it with ' so it stays text (CSV injection).
const csvCell = (raw: string) => {
  const s = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(events: AuditEvent[]): string {
  const head = ["Event", "Time", "Actor", "Action", "Record type", "Record", "IP", "Device", "Sensitive"]
  const rows = events.map((e) => [e.id, e.at, e.actor, ACTION[e.action].label, e.recordType, e.recordRef, e.ip, e.device, e.sensitive ? "Yes" : "No"])
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")
}

const nextId = (events: AuditEvent[]) => events.reduce((m, e) => Math.max(m, parseInt(e.id.replace(/\D/g, ""), 10) || 0), 0) + 1

/**
 * Adds events recorded on other screens (lib/audit-outbox.ts, e.g. a task purge) that the log doesn't have yet, prepended
 * newest first like an export.
 * Returns the same array when nothing is new, so re-running is a no-op.
 */
export function mergeOutbox(events: AuditEvent[], outbox: readonly OutboxAuditEvent[]): AuditEvent[] {
  const have = new Set(events.map((e) => e.sourceKey).filter(Boolean))
  const fresh = outbox.filter((o) => !have.has(o.key) && o.action in ACTION)
  if (fresh.length === 0) return events
  let id = nextId(events)
  const added = fresh.map((o): AuditEvent => ({
    id: `AUD-${id++}`,
    at: o.at,
    actor: o.actor,
    actorRole: o.actorRole,
    action: o.action as AuditAction,
    recordType: o.recordType,
    recordRef: o.recordRef,
    ip: "-",
    device: "This browser",
    sensitive: o.sensitive,
    meta: o.meta,
    sourceKey: o.key,
  }))
  return [...added.reverse(), ...events]
}

/** The audit event an export leaves behind (SRS: exports are sensitive and logged). Newest first, so prepend it. */
export function exportEvent(events: AuditEvent[], who: { actor: string; role: string }, at: string, rowCount: number, filename: string): AuditEvent {
  const max = events.reduce((m, e) => Math.max(m, parseInt(e.id.replace(/\D/g, ""), 10) || 0), 0)
  return {
    id: `AUD-${max + 1}`,
    at,
    actor: who.actor,
    actorRole: who.role,
    action: "export",
    recordType: "Audit log",
    recordRef: filename,
    ip: "-",
    device: "This browser",
    sensitive: true,
    meta: { Format: "CSV", Rows: String(rowCount) },
  }
}
