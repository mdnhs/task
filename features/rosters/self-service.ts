import { shiftEnd, type RosterShift } from "@/lib/rosters"
import { wallToEpoch, type Weekday } from "@/lib/shifts"
import type { Availability } from "@/lib/roster-rules"
import type { ApiExchange, ApiLeave, MineShift } from "./types"

// My roster on the API (B8 Task 22; FR-RS-23, 33, 40, 41). Pure helpers: the API decides every request again (leave overlap, who may decide, claim and swap rules); these only shape what the
// page offers, so a button shown by mistake is a short refusal, never a change.

/** Still to come: the shift's end instant (DST-correct, overnight ends next day) is after `now` (a wall clock in `tz`). */
export function isUpcoming(s: Pick<RosterShift, "date" | "start" | "end">, now: string, tz: string): boolean {
  return wallToEpoch(shiftEnd(s, tz), tz) > wallToEpoch(now.slice(0, 16), tz)
}

/** Still to come by the API's instants: the shift ends after `nowAt` (an ISO instant, the organisation's clock reading). Works across sites in other zones. */
export const endsAfter = (s: Pick<MineShift, "endAt">, nowAt: string): boolean => Date.parse(s.endAt) > Date.parse(nowAt)

/** Real minutes between the API's instants (a clock-change night is its real length). */
export const realMinutes = (s: Pick<MineShift, "startAt" | "endAt">): number => Math.round((Date.parse(s.endAt) - Date.parse(s.startAt)) / 60_000)

export const LEAVE_KINDS = [
  { value: "annual", label: "Annual" }, { value: "sick", label: "Sick" }, { value: "unpaid", label: "Unpaid" }, { value: "other", label: "Other" },
] as const
/** The label of a stored kind; a kind this list does not know (an import) is shown as stored. */
export const leaveKindLabel = (kind: string): string => LEAVE_KINDS.find((k) => k.value === kind)?.label ?? kind

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

/** What the person may do with their OWN leave: cancel a request still waiting, or an approved one that has not started (the API answers 422 leave_started otherwise). Never decide it. */
export const canCancelLeave = (l: ApiLeave, today: string): boolean => (l.status === "requested" || l.status === "approved") && l.from > today.slice(0, 10)

/**
 * The leave this caller may decide: the API listed it (its own cut: own requests plus the people the caller may decide for, D8) and it is waiting. The caller's OWN request is never one of
 * them, whatever the list holds (the API's 403 self_decision): nobody approves their own leave.
 */
export const toDecide = (queue: ApiLeave[], me: string): ApiLeave[] => queue.filter((l) => l.status === "requested" && !!me && l.personId !== me).sort((a, b) => a.from.localeCompare(b.from))

export type AvailabilityForm = { weekday: Weekday; from: string; to: string }
type Window = { weekday: number; from: string; to: string }

/** A window as the API stores it: same day, or split at midnight into the start day to 24:00 and the next day from 00:00 (a window ending at 00:00 is one row to 24:00). */
export function halves(f: AvailabilityForm): Window[] {
  if (f.to > f.from) return [{ weekday: f.weekday, from: f.from, to: f.to }]
  const first = { weekday: f.weekday, from: f.from, to: "24:00" }
  return f.to === "00:00" ? [first] : [first, { weekday: (f.weekday + 1) % 7, from: "00:00", to: f.to }]
}

/** An empty window (same start and end) or one already on record is refused here; anything else is the API's to judge (422 invalid_availability). */
export function validateAvailability(f: AvailabilityForm, have: Availability[] = []): string | null {
  if (!/^\d{2}:\d{2}$/.test(f.from) || !/^\d{2}:\d{2}$/.test(f.to)) return "Pick a start and end time"
  if (f.to === f.from) return "Start and end must differ"
  if (halves(f).every((w) => have.some((h) => h.weekday === w.weekday && h.from === w.from && h.to === w.to))) return "Already added"
  return null
}

/** The whole set for PUT /v1/roster/availability (the API replaces it at once): what is on record, plus `add`, minus `drop`. */
export function windowsBody(have: Availability[], o: { add?: AvailabilityForm; drop?: Availability } = {}): Window[] {
  const kept = have.filter((h) => h !== o.drop).map((h) => ({ weekday: h.weekday, from: h.from, to: h.to }))
  return o.add ? [...kept, { weekday: o.add.weekday, from: o.add.from, to: o.add.to }] : kept
}

const OPEN = new Set(["requested", "recommended"])
/** The person's own open claims and swaps (they may cancel them) and swaps offered TO them (they may decline). Decided ones are history, not shown. */
export function myRequests(list: ApiExchange[], me: string): { mine: ApiExchange[]; offered: ApiExchange[] } {
  if (!me) return { mine: [], offered: [] }
  const open = list.filter((x) => OPEN.has(x.status))
  return { mine: open.filter((x) => x.fromUserId === me), offered: open.filter((x) => x.kind === "swap" && x.toUserId === me) }
}
