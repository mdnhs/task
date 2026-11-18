import { actionInfo } from "./actions-catalogue"
import type { AuditEvent, AuditFilters } from "./types"

export const AUDIT_PAGE_SIZE = 15
/** The `actor` filter value for entries with no actor (system jobs): the API cannot filter them, so this one applies to the loaded rows. */
export const SYSTEM_ACTOR = "system"
export const EMPTY_FILTERS: AuditFilters = { q: "", actor: "all", action: "all", recordType: "all", from: "", to: "" }

/** The text search and "System" (the API cannot do those) and, on the loaded rows, every other filter too (the API already applied them, so that is a no-op there). `actor` is a member id, "system" or "all". */
export function filterEvents(events: AuditEvent[], f: AuditFilters): AuditEvent[] {
  const q = f.q.trim().toLowerCase()
  return events.filter((e) => {
    const day = e.at.slice(0, 10)
    return (
      (f.actor === "all" || (f.actor === SYSTEM_ACTOR ? e.actorId === null : e.actorId === f.actor)) &&
      (f.action === "all" || e.action === f.action) &&
      (f.recordType === "all" || e.recordType === f.recordType) &&
      (!f.from || day >= f.from) &&
      (!f.to || day <= f.to) &&
      (!q || [e.id, e.actor, e.action, actionInfo(e.action).label, e.recordType, e.recordRef, ...Object.values(e.meta)].some((s) => s.toLowerCase().includes(q)))
    )
  })
}
