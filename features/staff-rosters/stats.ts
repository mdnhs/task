import { daysBetween } from "@/lib/dates"
import type { Incident, RosterGap } from "./types"

// The three coverage numbers the dashboard shows (public/data/dashboard/coverage.json) plus open incidents, all derived from the same records.
export function rosterStats(incidents: Incident[], gaps: RosterGap[], today: string) {
  return {
    uncoveredTomorrow: gaps.filter((g) => g.when === "tomorrow" && g.coverage === "uncovered").length,
    gapsNextWeek: gaps.filter((g) => g.when === "next_week" && g.coverage !== "covered").length,
    calloutsCoveredToday: incidents.filter((i) => i.type === "callout" && i.status === "covered" && daysBetween(i.reportedAt, today) === 0).length,
    openIncidents: incidents.filter((i) => i.status === "open" || i.status === "escalated").length,
  }
}
