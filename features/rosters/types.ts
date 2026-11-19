import type { LocationGrant, RosterAccess } from "@/lib/roster-access"
import type { WorkforceMember } from "@/lib/workforce"
import type { WeekTemplate } from "@/lib/roster-repeat"
import type { Availability, LeaveRequest, RuleId, RuleSeverity, RuleViolation } from "@/lib/roster-rules"
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
export type RosterRules = { avgWeekReferenceWeeks: number; severity: Record<RuleId, RuleSeverity>; leave: LeaveRequest[]; availability: Availability[] }

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

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The API-backed shapes (B8 Task 19). They EXTEND the domain types (`RosterShift`, `RosterWeek`, `ShiftTemplate`, ...) with what the API adds (version, instants,
// archived), so the pure functions of `@opsdesk/domain` keep working on them unchanged. Wall strings (`date`, `start`, `end`) are the tenant's or the location's clock (R8-2);
// `startAt` / `endAt` are the real UTC instants. Nothing here is re-scoped in the browser: the API already cut everything to what the caller may see (I14).

/** A location as the API sends it. `lat`, `lng` and `timeZone` may be null (not set); nothing is invented for them. */
export type RosterLocation = {
  id: string; name: string; address: string; lat: number | null; lng: number | null; zoneRadiusM: number | null; openingHours: Record<string, string>
  contact: string; swapApprovalDelegated: boolean; timeZone: string | null; version: number; archived: boolean; supervisorIds: string[]
}
export type ShiftType = ShiftTemplate & { targets: { weekday: number; count: number }[]; archived: boolean; version: number }
export type WeekShift = RosterShift & { version: number; startAt: string; endAt: string }
export type WeekDay = { date: string; shiftIds: string[]; count: number; target: number; short: number; over: number }
export type WeekRoster = RosterWeek & { version: number; days: WeekDay[] }
export type RosterMember = { id: string; name: string; active: boolean; homeLocationId: string | null }
export type ViewKind = "day" | "week" | "fortnight" | "month"
export type RosterPayload = {
  range: { from: string; to: string; view: ViewKind }; weeks: WeekRoster[]; shifts: WeekShift[]; shiftTypes: ShiftType[]; members: RosterMember[]; membersTruncated: boolean; locations: RosterLocation[]
}
export type WeekQuery = { locationId?: string; from?: string; to?: string; view?: ViewKind }

export type ApiChangeRequest = {
  id: string; shiftId: string; weekId: string; locationId: string; shiftVersion: number; requestedBy: string; patch: Record<string, string | number | null>; reason: string
  status: "requested" | "approved" | "rejected"; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string
}
export type ExchangeStatus = "requested" | "recommended" | "approved" | "rejected" | "cancelled"
export type ApiExchange = {
  id: string; kind: "claim" | "swap"; shiftId: string; weekId: string; locationId: string; date: string; start: string; end: string; fromUserId: string; toUserId: string | null
  status: ExchangeStatus; note: string; decidedBy: string | null; decidedAt: string | null; createdAt: string; expired: boolean
}
export type ApiLeave = {
  id: string; personId: string; from: string; to: string; kind: string; status: "requested" | "approved" | "rejected" | "cancelled"; note: string
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; createdAt: string
}
export type Page<T> = { items: T[]; nextCursor: string | null }

export type MineShift = {
  id: string; date: string; start: string; end: string; startAt: string; endAt: string; unpaidBreakMin: number; role: string; shiftType: string; confirmedAt: string | null
  version: number; locationId: string; locationName: string; locationAddress: string; timeZone: string
}
export type MyRoster = { from: string; to: string; shifts: MineShift[]; truncated: boolean; availability: Availability[]; leave: ApiLeave[] }
export type LeaveQueueData = Page<ApiLeave>
export type ExchangeQuery = { from?: string; to?: string; status?: ExchangeStatus; shiftId?: string; cursor?: string }
export type ExchangeBoard = Page<ApiExchange> & { openShifts: WeekShift[] }
export type LocationAdmin = { location: RosterLocation; shiftTypes: ShiftType[]; history: Page<HistoryEntry> }

export type RulesView = { severity: Record<string, "block" | "warn" | "ignore">; avgWeekReferenceWeeks: number; draftWarnDays: number; etag: string | null }
export type WeekTemplateSummary = { id: string; locationId: string; name: string; shifts: number; createdAt: string; createdBy: string | null }
export type CoverageDay = { date: string; weekId: string; status: "draft" | "published"; staff: number; target: number; short: number; over: number; open: number }
export type Coverage = { from: string; to: string; locations: { locationId: string; name: string; days: CoverageDay[] }[] }
export type RepeatConflict = { weekId: string; shiftId: string; personId: string; date: string; reason: string; open: boolean; message: string }
export type RepeatCounts = { copied: number; kept: number; warned: number; opened: number }

/** What a roster write answered with; see ./errors.ts. */
export type { RosterError, RosterWriteResult } from "./errors"
