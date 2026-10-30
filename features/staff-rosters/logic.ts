import { z } from "zod"

import { COVERAGE } from "./types"
import type { Coverage, HistoryEntry, Incident, RosterGap, StaffMember } from "./types"

// Pure rules shared by the Log incident page and the roster gap page (no React, server-safe).

export const incidentSchema = z.object({
  type: z.enum(["callout", "noshow", "cover", "staff_issue"], { message: "Choose a type" }),
  staff: z.string().min(1, "Choose the staff member"),
  site: z.string().trim().min(2, "Enter the site").max(80, "Keep the site under 80 characters"),
  client: z.string().trim().min(2, "Enter the client").max(80, "Keep the client under 80 characters"),
  shift: z.string().trim().min(2, "Enter the shift or subject").max(40, "Keep it under 40 characters"),
  action: z.string().trim().min(3, "Enter the next action").max(160, "Keep the action under 160 characters"),
  contact: z.string().trim().max(40),
  notes: z.string().trim().max(500, "Keep the notes under 500 characters"),
})
export type IncidentInput = z.output<typeof incidentSchema>

export type GapCoverInput = { coverage: Coverage; assigned: string; nextAction: string }

/** The /staff-rosters tab a search param asks for; anything else is the default Attendance tab. */
export type RostersTab = "attendance" | "gaps"
export const rostersTab = (v: unknown): RostersTab => (v === "gaps" ? "gaps" : "attendance")
export const rostersHref = (tab: RostersTab) => (tab === "gaps" ? "/staff-rosters?tab=gaps" : "/staff-rosters")
export const gapHref = (id: string) => `/staff-rosters/gaps/${encodeURIComponent(id)}`

/** Next INC-n id: one above the highest number in use. */
export function nextIncidentId(rows: Pick<Incident, "id">[]): string {
  const max = rows.reduce((m, i) => Math.max(m, parseInt(i.id.replace(/\D/g, ""), 10) || 0), 0)
  return `INC-${max + 1}`
}

/** A newly logged incident: open, no cover, owned by the actor; dept comes from the staff list. */
export function createIncident(prev: Incident[], v: IncidentInput, staff: StaffMember[], h: HistoryEntry): Incident {
  return {
    id: nextIncidentId(prev),
    type: v.type,
    staff: v.staff,
    dept: staff.find((s) => s.name === v.staff)?.dept ?? "",
    shift: v.shift,
    site: v.site,
    client: v.client,
    cover: null,
    status: "open",
    owner: h.by,
    action: v.action,
    reportedAt: h.at,
    history: [h],
    ...(v.contact ? { contact: v.contact } : {}),
    ...(v.notes ? { notes: v.notes } : {}),
  }
}

/** History note for a cover update: "Partly covered, Grace Mensah" or just the coverage label. */
export const gapCoverNote = (v: GapCoverInput) => (v.assigned ? `${COVERAGE[v.coverage].label}, ${v.assigned}` : COVERAGE[v.coverage].label)

export function updateGapCover(g: RosterGap, v: GapCoverInput, at: string, by: string): RosterGap {
  return { ...g, ...v, history: [...g.history, { at, by, action: "Cover updated", note: gapCoverNote(v) }] }
}
