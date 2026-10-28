import type { Status } from "@/lib/types"

export type IncidentType = "callout" | "noshow" | "cover" | "staff_issue"
export type IncidentStatus = "open" | "covered" | "escalated" | "resolved"
export type When = "today" | "tomorrow" | "next_week"
export type Coverage = "covered" | "partial" | "uncovered"

export type HistoryEntry = { at: string; by: string; action: string; note?: string }

export type StaffMember = { id: string; name: string; role: string; dept: string }

export type Incident = {
  id: string
  type: IncidentType
  staff: string
  dept: string
  /** Shift time range ("18:00–02:00") or the subject of a staff issue ("Licence"). */
  shift: string
  site: string
  client: string
  cover: string | null
  status: IncidentStatus
  owner: string
  action: string
  reportedAt: string
  /** Sensitive (FR-STAFF-03): the server drops these two fields for roles without staff write access. */
  contact?: string
  notes?: string
  history: HistoryEntry[]
}

export type RosterGap = {
  id: string
  when: When
  /** ISO start of the shift (wall-clock, tenant timezone). */
  shiftStart: string
  /** Time range, e.g. "22:00–06:00". */
  time: string
  site: string
  client: string
  role: string
  dept: string
  assigned: string
  coverage: Coverage
  owner: string
  nextAction: string
  /** Sensitive (FR-STAFF-03), see Incident. */
  notes?: string
  history: HistoryEntry[]
}

export const STAFF_PAGE_SIZE = 10

export const INCIDENT_TYPE: Record<IncidentType, string> = {
  callout: "Call-out",
  noshow: "No-show",
  cover: "Cover",
  staff_issue: "Staff issue",
}
export const INCIDENT_STATUS: Record<IncidentStatus, Status> = {
  open: { tone: "warn", label: "Open" },
  covered: { tone: "ok", label: "Covered" },
  escalated: { tone: "bad", label: "Escalated" },
  resolved: { tone: "mute", label: "Resolved" },
}
export const COVERAGE: Record<Coverage, Status> = {
  covered: { tone: "ok", label: "Covered" },
  partial: { tone: "warn", label: "Partly covered" },
  uncovered: { tone: "bad", label: "Uncovered" },
}
export const WHEN_LABEL: Record<When, string> = { today: "Today", tomorrow: "Tomorrow", next_week: "Next week" }
export const WHEN_ORDER: When[] = ["today", "tomorrow", "next_week"]
