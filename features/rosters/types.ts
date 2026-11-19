import type { Availability } from "@/lib/roster-rules"
import type { HistoryEntry, RosterShift, RosterWeek, ShiftTemplate } from "@/lib/rosters"

export type {
  DayColumn,
  HistoryEntry,
  Location,
  RosterShift,
  RosterWeek,
  ShiftTemplate,
  StaffingTarget,
} from "@/lib/rosters"

/** The week view's query string (`?location=&week=&view=&group=`): the location uuid and the week's Monday (R8-18). */
export type RosterQuery = { location?: string; week?: string; view?: string; group?: string }

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
/** What the API says the caller may do (derived from its write gate; the web never re-derives it): `locked` = published and this level may not edit it; `reason_required` = an office role editing a published week must give a reason. */
export type WeekAccess = { level: "office" | "supervisor" | null; canEdit: boolean; locked: boolean; lockReason: "forbidden" | "roster_locked" | "reason_required" | null }
export type WeekRoster = RosterWeek & { version: number; days: WeekDay[]; access: WeekAccess }
export type RosterMember = { id: string; name: string; active: boolean; homeLocationId: string | null }
export type ViewKind = "day" | "week" | "fortnight" | "month"
export type RosterPayload = {
  range: { from: string; to: string; view: ViewKind }; weeks: WeekRoster[]; shifts: WeekShift[]; shiftTypes: ShiftType[]; members: RosterMember[]; membersTruncated: boolean; locations: RosterLocation[]; /** The caller's access to a DRAFT week (can they create and edit weeks at all). */ access: WeekAccess
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
export type MyRoster = { from: string; to: string; shifts: MineShift[]; truncated: boolean; availability: Availability[]; leave: ApiLeave[]; access: WeekAccess }
export type LeaveQueueData = Page<ApiLeave>
export type ExchangeQuery = { from?: string; to?: string; status?: ExchangeStatus; shiftId?: string; cursor?: string }
export type ExchangeBoard = Page<ApiExchange> & { openShifts: WeekShift[] }
export type LocationAdmin = { location: RosterLocation; shiftTypes: ShiftType[]; history: Page<HistoryEntry> }
/** The people the caller may pick in a roster (the week payload's members: the API cut them to the caller's sites; capped, `truncated` says more exist) and the caller's draft-week access. */
export type RosterPeople = { members: RosterMember[]; truncated: boolean; access: WeekAccess }
/** One licence or skill of a person as the API judges it on its clock: `expired` (the day after the expiry date) and `dueSoon` (within 30 days of it, not expired). */
export type Qualification = { type: string; expiresOn: string | null; expired: boolean; dueSoon: boolean }

export type RulesView = { severity: Record<string, "block" | "warn" | "ignore">; avgWeekReferenceWeeks: number; draftWarnDays: number; etag: string | null }
export type WeekTemplateSummary = { id: string; locationId: string; name: string; shifts: number; createdAt: string; createdBy: string | null }
export type CoverageDay = { date: string; weekId: string; status: "draft" | "published"; staff: number; target: number; short: number; over: number; open: number }
export type Coverage = { from: string; to: string; locations: { locationId: string; name: string; days: CoverageDay[] }[] }
export type RepeatConflict = { weekId: string; shiftId: string; personId: string; date: string; reason: string; open: boolean; message: string }
export type RepeatCounts = { copied: number; kept: number; warned: number; opened: number }

/** What a roster write answered with; see ./errors.ts. */
export type { RosterError, RosterWriteResult } from "./errors"
