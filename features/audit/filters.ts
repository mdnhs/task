import { ACTION } from "./types"
import type { AuditEvent, AuditFilters } from "./types"

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

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

export function toCsv(events: AuditEvent[]): string {
  const head = ["Event", "Time", "Actor", "Action", "Record type", "Record", "IP", "Device", "Sensitive"]
  const rows = events.map((e) => [e.id, e.at, e.actor, ACTION[e.action].label, e.recordType, e.recordRef, e.ip, e.device, e.sensitive ? "Yes" : "No"])
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n")
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
