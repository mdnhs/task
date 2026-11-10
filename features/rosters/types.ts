import type { LocationGrant, RosterAccess } from "@/lib/roster-access"
import type { WorkforceMember } from "@/lib/workforce"
import type { WeekTemplate } from "@/lib/roster-repeat"
import type { Availability, LeaveRequest, RuleId, RuleViolation } from "@/lib/roster-rules"
import type { HistoryEntry, Location, RosterShift, RosterWeek, ShiftTemplate, StaffingTarget } from "@/lib/rosters"

export type {
  DayColumn,
  HistoryEntry,
  Location,
  RosterShift,
  RosterWeek,
  ShiftTemplate,
  StaffingTarget,
} from "@/lib/rosters"

/** A supervisor's request to change a published shift (FR-RS-36). `patch` holds only the fields to change. */
export type ChangeRequest = {
  id: string
  weekId: string
  shiftId: string
  by: string
  at: string
  patch: Partial<RosterShift>
  why: string
  status: "open" | "approved" | "rejected"
  decidedBy: string | null
  decidedAt: string | null
  note: string | null
}

/** A staff member's offer to take an open shift (FR-RS-38). The approver decides (D6). */
export type Claim = { id: string; shiftId: string; personId: string; at: string; status: "open" | "approved" | "rejected"; decidedBy: string | null; decidedAt: string | null }
/** A request to hand a shift over (`toShiftId` null) or trade it for the other person's (FR-RS-42/43). */
export type SwapRequest = { id: string; shiftId: string; toShiftId: string | null; fromPersonId: string; toPersonId: string; at: string; status: "open" | "approved" | "rejected"; decidedBy: string | null; decidedAt: string | null }

/** Open claims and swaps at the permitted locations, with the names of the people on them only (a supervisor's member list is cut). */
export type ExchangeData = { claims: Claim[]; swaps: SwapRequest[]; names: Record<string, string>; /** The people on them, for the eligibility check at approval (licences cut to what the permitted locations require). */ members: WorkforceMember[] }

/**
 * What /rosters/mine needs for open shifts and swaps, cut to one person on the server: the open shifts they may take (published, still to come,
 * at a location they work or call home, licence valid), their own member record, the templates of those shifts, id and name of eligible
 * co-workers for each of their own shifts (no licences, no other data) and their own claims and swap requests.
 */
export type MyExchange = {
  member: WorkforceMember | null
  open: RosterShift[]
  templates: ShiftTemplate[]
  peers: Record<string, { id: string; name: string }[]>
  claims: Claim[]
  swaps: SwapRequest[]
  locations: { id: string; name: string }[]
  /** The weeks of the open shifts and own upcoming shifts, so a claim or swap can check the roster is published. */
  weeks: RosterWeek[]
}

export type RosterData = {
  locations: Location[]
  templates: ShiftTemplate[]
  targets: StaffingTarget[]
  weeks: RosterWeek[]
  shifts: RosterShift[]
  members: WorkforceMember[]
}

/** Payload of the locations admin pages (office roles only): the permitted locations with their templates, targets, grants and shifts (for the in-use check). */
export type LocationAdminData = {
  locations: Location[]
  templates: ShiftTemplate[]
  targets: StaffingTarget[]
  shifts: RosterShift[]
  grants: LocationGrant[]
  members: WorkforceMember[]
  /** Skills and licences on record, offered as required skills. */
  skills: string[]
  /** Change history of the permitted locations, the same list the Rosters page seeds, so the shared store holds one history. */
  history: HistoryEntry[]
}

export type RosterQuery = { location?: string; week?: string; view?: string; group?: string }

/**
 * What the Rosters page needs to edit in the browser (roles that can edit only): the payload already cut by access, the role's access, the page
 * query, the store scope, the signed-in person and the current time. The client rebuilds the view from the stores, so edits show at once.
 */
/** Rule settings plus the leave and availability of the people on the caller's shifts. */
export type RosterRules = { avgWeekReferenceWeeks: number; severity: Record<RuleId, "block" | "warn">; leave: LeaveRequest[]; availability: Availability[] }

export type RosterEdit = {
  roster: RosterData
  access: RosterAccess
  query: RosterQuery
  scopeKey: string
  me: string
  now: string
  /** Rule data cut to the caller (server `getRosterRules`), the tenant time zone, change history and change requests for the permitted locations. */
  extra: RosterEditExtra
  /** Server action: rule check of a week over ALL shifts (cross-site clashes included) given the caller's own shifts of that week, results for those shifts only. Absent in skeletons. */
  checkWeek?: (weekId: string, shifts: RosterShift[]) => Promise<RuleViolation[]>
  /** Server action: rule check of hypothetical assignments (open claim, swap) over ALL shifts; results for the caller's locations only. */
  checkAssign?: (assign: { shiftId: string; personId: string }[]) => Promise<RuleViolation[]>
}
/** `weekTemplates` are the saved weekly templates of the permitted locations; `holidays` the public-holiday dates (ISO) for repeat checks. */
export type RosterEditExtra = { rules: RosterRules; tz: string; history: HistoryEntry[]; requests: ChangeRequest[]; weekTemplates: WeekTemplate[]; holidays: string[]; exchange: ExchangeData; /** The role can open Staff & Rosters, so the open-shifts panel may link to the derived gaps. */ gapsLink: boolean }
export type { WeekTemplate }

/** Payload of /rosters/mine: the signed-in person's own published shifts (all locations), leave and availability. */
export type MyRosterData = { shifts: RosterShift[]; weeks: RosterWeek[]; locations: Location[]; leave: LeaveRequest[]; availability: Availability[] }
/** Waiting leave requests the caller may decide (D8), with the names of those people only. */
export type LeaveQueue = { leave: LeaveRequest[]; names: Record<string, string> }
