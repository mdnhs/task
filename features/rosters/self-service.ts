import { canSeeLocation, type RosterAccess } from "@/lib/roster-access"
import type { LeaveRequest } from "@/lib/roster-rules"
import { shiftEnd, type RosterShift, type RosterWeek } from "@/lib/rosters"
import { wallToEpoch, type Weekday } from "@/lib/shifts"
import type { Availability } from "@/lib/roster-rules"
import type { WorkforceMember } from "@/lib/workforce"

// Staff self-service (FR-RS-23, 33, 40, 41). Pure helpers; the server cuts the payload (api.ts) and the stores hold edits until reload.

/** One person's published shifts across every location, soonest first. Drafts and other people's shifts never appear (FR-RS-33). */
export function combinedRoster(personId: string, shifts: RosterShift[], weeks: RosterWeek[]): RosterShift[] {
  const published = new Set(weeks.filter((w) => w.status === "published").map((w) => w.id))
  return shifts
    .filter((s) => s.personId === personId && published.has(s.weekId))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start) || a.id.localeCompare(b.id))
}

/**
 * Who decides a leave request (D8): office roles for people homed at a location they see (or nowhere), a supervisor only for people whose home location they manage.
 * Read-only roles (own scope, auditors) never.
 */
export function canApproveLeave(a: RosterAccess, m: WorkforceMember): boolean {
  if (a.scope === "all") return (a.approve || a.editPublished) && (m.homeLocationId === null || canSeeLocation(a, m.homeLocationId))
  if (a.scope === "locations") return a.editDraft && !!m.homeLocationId && !!a.locationIds?.includes(m.homeLocationId)
  return false
}

/** Approve or reject a request that is still waiting. Anything already decided is refused. */
export function decideLeave(r: LeaveRequest, approve: boolean, by: string, at: string): LeaveRequest {
  if (r.personId === by) throw new Error("Nobody decides their own leave")
  if (r.status !== "requested") throw new Error("Leave request already decided")
  return { ...r, status: approve ? "approved" : "rejected", decidedBy: by, decidedAt: at }
}

/** Requests still waiting from people the caller may decide for, soonest start first. */
export function leaveQueue(leave: LeaveRequest[], members: WorkforceMember[], a: RosterAccess): LeaveRequest[] {
  const byId = new Map(members.map((m) => [m.id, m]))
  return leave
    .filter((l) => l.status === "requested" && byId.has(l.personId) && canApproveLeave(a, byId.get(l.personId)!))
    .sort((x, y) => x.from.localeCompare(y.from) || x.id.localeCompare(y.id))
}

export type LeaveForm = { from: string; to: string; kind: string }
export type LeaveErrors = Partial<Record<keyof LeaveForm, string>>

export function validateLeave(f: LeaveForm): LeaveErrors {
  const e: LeaveErrors = {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from)) e.from = "Pick a start date"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.to)) e.to = "Pick an end date"
  else if (!e.from && f.to < f.from) e.to = "End is before the start"
  if (!f.kind.trim()) e.kind = "Pick a type"
  return e
}

export type AvailabilityForm = { weekday: Weekday; from: string; to: string }

/**
 * A not-available window on one weekday. `to` at or before `from` means it runs past midnight (22:00 to 06:00); only an empty window
 * (same time) is refused. With `have`, an identical window is refused.
 */
export function validateAvailability(f: AvailabilityForm, personId?: string, have: Availability[] = []): string | null {
  if (!/^\d{2}:\d{2}$/.test(f.from) || !/^\d{2}:\d{2}$/.test(f.to)) return "Pick a start and end time"
  if (f.to === f.from) return "Start and end must differ"
  if (splitAvailability(personId ?? "", f).every((w) => have.some((h) => h.personId === w.personId && h.weekday === w.weekday && h.from === w.from && h.to === w.to))) return "That window is already added"
  return null
}

/**
 * The rule check reads a window as same-day (weekday, from to to), so an overnight window is stored as two:
 * the start day to 23:59 and the next day from 00:00.
 */
export function splitAvailability(personId: string, f: AvailabilityForm): Availability[] {
  if (f.to > f.from) return [{ personId, weekday: f.weekday, from: f.from, to: f.to }]
  return [
    { personId, weekday: f.weekday, from: f.from, to: "23:59" },
    { personId, weekday: ((f.weekday + 1) % 7) as Weekday, from: "00:00", to: f.to },
  ]
}

/** What identifies the shift a person confirmed: if any of it changes, the confirmation no longer applies. */
export const shiftSig = (s: Pick<RosterShift, "date" | "start" | "end" | "locationId">): string => `${s.date}|${s.start}|${s.end}|${s.locationId}`
export type Confirmation = { at: string; sig: string }

/** Seen: a confirmation made here for this exact shift, or one on record (an office edit clears the record). */
export function isSeen(s: RosterShift, confirmed: Record<string, Confirmation>): boolean {
  const c = confirmed[s.id]
  return (!!c && c.sig === shiftSig(s)) || s.confirmedAt !== null
}

/**
 * The person's published shifts with this session's roster edits applied (the Rosters page stores): for weeks the live stores cover,
 * the live shifts win (moves, deletions, publish status); other weeks keep the server list. Only this person's shifts come out.
 */
export function mergeMine(personId: string, shifts: RosterShift[], weeks: RosterWeek[], live?: { shifts: RosterShift[]; weeks: RosterWeek[] }): RosterShift[] {
  if (!live) return combinedRoster(personId, shifts, weeks)
  const liveWeeks = new Set(live.weeks.map((w) => w.id))
  const allWeeks = [...weeks.filter((w) => !liveWeeks.has(w.id)), ...live.weeks]
  const all = [...shifts.filter((x) => !liveWeeks.has(x.weekId)), ...live.shifts]
  return combinedRoster(personId, all, allWeeks)
}

/** Still to come: the shift's end instant (DST-correct, overnight ends next day) is after `now` (tenant wall clock). */
export function isUpcoming(s: Pick<RosterShift, "date" | "start" | "end">, now: string, tz: string): boolean {
  return wallToEpoch(shiftEnd(s, tz), tz) > wallToEpoch(now.slice(0, 16), tz)
}

let seq = 0
export const newLeaveId = (): string => `lv-${Date.now().toString(36)}${(seq++).toString(36)}`
