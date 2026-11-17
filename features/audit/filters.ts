import { actionInfo } from "./actions-catalogue"
import type { AuditEvent, AuditFilters } from "./types"

export const AUDIT_PAGE_SIZE = 15
export const EMPTY_FILTERS: AuditFilters = { q: "", actor: "all", action: "all", recordType: "all", from: "", to: "" }

/** The filters the API cannot do (actor, action, text) and, on the loaded page, the dates and record type too (the page loads with the API's query for those, so this is a no-op there). */
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
      (!q || [e.id, e.actor, e.action, actionInfo(e.action).label, e.recordType, e.recordRef, ...Object.values(e.meta)].some((s) => s.toLowerCase().includes(q)))
    )
  })
}
