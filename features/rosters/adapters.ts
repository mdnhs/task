// Pure mappers from the roster API's DTOs to the UI's types (B8 Task 19). They return the domain shapes (`RosterShift` with `personId` / `templateId`, ...) plus what the API adds,
// so the pure functions of `@opsdesk/domain` keep working unchanged. Each mapper copies the fields it knows and nothing else: a field the API grows later is DROPPED here, never
// handed to a component. A missing or mistyped required field THROWS (lib/api/read.ts): a renamed field must not become a silent "" or 0. Nothing is converted or recomputed:
// wall strings stay wall strings (the location's clock, R8-2), instants stay the API's UTC strings, and no name or place is ever made up.
import { reader, type Rec } from "@/lib/api/read"
import type { Availability, RuleViolation, ViolationRule } from "@/lib/roster-rules"
import type { Weekday } from "@/lib/shifts"
import type {
  ApiChangeRequest, ApiExchange, ApiLeave, Coverage, ExchangeStatus, HistoryEntry, MineShift, MyRoster, Page, Qualification, RepeatConflict, RepeatCounts, RosterLocation, RosterMember, RosterPayload, RosterPeople,
  RulesView, ShiftType, ViewKind, WeekAccess, WeekDay, WeekRoster, WeekShift, WeekTemplateSummary,
} from "./types"

const r = reader("rosters")
const list = <T>(v: unknown, f: (x: unknown) => T): T[] => (Array.isArray(v) ? v.map(f) : r.arr({ v } as Rec, "v").map(f))
const strRecord = (v: unknown, k: string): Record<string, string> => {
  const o = r.rec(v, k)
  return Object.fromEntries(Object.entries(o).map(([key, val]) => [key, typeof val === "string" ? val : (r.str({ [key]: val }, key) as never)]))
}
const VIOLATION_RULES = ["double_booking", "approved_leave", "unavailable", "daily_rest", "weekly_rest", "avg_48h", "expired_licence", "left", "elsewhere"] as const satisfies readonly ViolationRule[]
const VIEWS = ["day", "week", "fortnight", "month"] as const satisfies readonly ViewKind[]
const EXCHANGE_STATUSES = ["requested", "recommended", "approved", "rejected", "cancelled"] as const satisfies readonly ExchangeStatus[]

export function toLocation(dto: unknown): RosterLocation {
  const o = r.rec(dto, "location")
  return {
    id: r.str(o, "id"), name: r.str(o, "name"), address: r.str(o, "address"), lat: numOrNull(o, "lat"), lng: numOrNull(o, "lng"), zoneRadiusM: r.intOrNull(o, "zoneRadiusM"),
    openingHours: strRecord(o.openingHours, "openingHours"), contact: r.str(o, "contact"), swapApprovalDelegated: r.bool(o, "swapApprovalDelegated"), timeZone: r.strOrNull(o, "timeZone"),
    version: r.int(o, "version"), archived: r.bool(o, "archived"), supervisorIds: list(o.supervisorIds, (x) => r.str({ x } as Rec, "x")),
  }
}
function numOrNull(o: Rec, k: string): number | null {
  return o[k] === null ? null : r.num(o, k)
}

export function toShiftType(dto: unknown): ShiftType {
  const o = r.rec(dto, "shiftType")
  return {
    id: r.str(o, "id"), locationId: r.str(o, "locationId"), name: r.str(o, "name"), start: r.str(o, "start"), end: r.str(o, "end"), unpaidBreakMin: r.int(o, "unpaidBreakMin"), role: r.str(o, "role"),
    requires: list(o.requires, (x) => r.str({ x } as Rec, "x")), archived: r.bool(o, "archived"), version: r.int(o, "version"),
    targets: list(o.targets, (t) => {
      const x = r.rec(t, "target")
      return { weekday: r.int(x, "weekday") as Weekday, count: r.int(x, "count") }
    }),
  }
}

export function toShift(dto: unknown): WeekShift {
  const o = r.rec(dto, "shift")
  return {
    id: r.str(o, "id"), weekId: r.str(o, "weekId"), locationId: r.str(o, "locationId"), date: r.str(o, "date"), personId: r.strOrNull(o, "userId"), templateId: r.str(o, "shiftTypeId"),
    role: r.str(o, "role"), start: r.str(o, "start"), end: r.str(o, "end"), unpaidBreakMin: r.int(o, "unpaidBreakMin"), confirmedAt: r.strOrNull(o, "confirmedAt"),
    version: r.int(o, "version"), startAt: r.str(o, "startAt"), endAt: r.str(o, "endAt"),
  }
}

function toDay(dto: unknown): WeekDay {
  const o = r.rec(dto, "day")
  return { date: r.str(o, "date"), shiftIds: list(o.shiftIds, (x) => r.str({ x } as Rec, "x")), count: r.int(o, "count"), target: r.int(o, "target"), short: r.int(o, "short"), over: r.int(o, "over") }
}

const LOCK_REASONS = ["forbidden", "roster_locked", "reason_required"] as const
/** The API's own verdict of what the caller may do (api/.../scope.ts `accessInfo`). The web shows it and never works it out again. */
export function toAccess(dto: unknown): WeekAccess {
  const o = r.rec(dto, "access")
  const level = o.level === null ? null : r.oneOf(o, "level", ["office", "supervisor"] as const)
  const lockReason = o.lockReason === null ? null : r.oneOf(o, "lockReason", LOCK_REASONS)
  return { level, canEdit: r.bool(o, "canEdit"), locked: r.bool(o, "locked"), lockReason }
}

export function toWeek(dto: unknown): WeekRoster {
  const o = r.rec(dto, "week")
  return {
    id: r.str(o, "id"), locationId: r.str(o, "locationId"), weekStart: r.str(o, "weekStart"), status: r.oneOf(o, "status", ["draft", "published"] as const), publishedAt: r.strOrNull(o, "publishedAt"),
    publishedBy: r.strOrNull(o, "publishedBy"), autoRepeatDays: r.intOrNull(o, "autoRepeatDays"), version: r.int(o, "version"), days: list(o.days, toDay), access: toAccess(o.access),
  }
}

export function toMember(dto: unknown): RosterMember {
  const o = r.rec(dto, "member")
  return { id: r.str(o, "userId"), name: r.str(o, "name"), active: r.bool(o, "active"), homeLocationId: r.strOrNull(o, "homeLocationId") }
}

/** GET /v1/roster/weeks plus the caller's locations (GET /v1/locations). The locations are exactly the ones the API listed: a shift's location that is not in the list has no name here. */
export function toWeeksPayload(dto: unknown, locations: unknown): RosterPayload {
  const o = r.rec(dto, "weeks")
  const range = r.rec(o.range, "range")
  return {
    range: { from: r.str(range, "from"), to: r.str(range, "to"), view: r.oneOf(range, "view", VIEWS) }, weeks: list(o.weeks, toWeek), shifts: list(o.shifts, toShift),
    shiftTypes: list(o.shiftTypes, toShiftType), members: list(o.members, toMember), membersTruncated: r.bool(o, "membersTruncated"), locations: list(locations, toLocation), access: toAccess(o.access),
  }
}

/** The pick list of GET /v1/roster/weeks (members, the cap flag and the draft-week access); the weeks and shifts of that read are not needed here. */
export function toPeople(dto: unknown): RosterPeople {
  const o = r.rec(dto, "weeks")
  return { members: list(o.members, toMember), truncated: r.bool(o, "membersTruncated"), access: toAccess(o.access) }
}

/** GET|PUT /v1/members/{userId}/qualifications: expiry state as the API computed it (never re-judged here). */
export function toQualifications(dto: unknown): Qualification[] {
  const o = r.rec(dto, "qualifications")
  return list(o.items, (q) => {
    const x = r.rec(q, "qualification")
    return { type: r.str(x, "type"), expiresOn: r.strOrNull(x, "expiresOn"), expired: r.bool(x, "expired"), dueSoon: r.bool(x, "dueSoon") }
  })
}

export function toViolation(dto: unknown): RuleViolation {
  const o = r.rec(dto, "violation")
  return {
    rule: r.oneOf(o, "rule", VIOLATION_RULES), shiftId: r.str(o, "shiftId"), personId: r.str(o, "personId"), severity: r.oneOf(o, "severity", ["block", "warn"] as const), message: r.str(o, "message"),
    otherShiftIds: list(o.otherShiftIds, (x) => r.str({ x } as Rec, "x")),
  }
}
export const toViolations = (dto: unknown): RuleViolation[] => list(dto, toViolation)

export function toHistory(dto: unknown): HistoryEntry {
  const o = r.rec(dto, "history")
  const snap = (k: string): unknown => (o[k] === null ? null : r.rec(o[k], k))
  return {
    id: r.str(o, "id"), weekId: r.strOrNull(o, "weekId"), locationId: r.str(o, "locationId"), shiftId: r.strOrNull(o, "shiftId"), at: r.str(o, "at"), by: r.str(o, "actorId"), action: r.str(o, "action"),
    before: snap("before"), after: snap("after"), reason: r.strOrNull(o, "reason"),
  }
}

const PATCH_KEYS = ["date", "start", "end", "unpaidBreakMin", "userId", "shiftTypeId", "role"] as const
export function toChangeRequest(dto: unknown): ApiChangeRequest {
  const o = r.rec(dto, "changeRequest")
  const raw = r.rec(o.patch, "patch")
  const patch: ApiChangeRequest["patch"] = {}
  for (const k of PATCH_KEYS) if (k in raw) patch[k] = raw[k] === null ? null : typeof raw[k] === "number" ? (raw[k] as number) : r.str(raw, k)
  return {
    id: r.str(o, "id"), shiftId: r.str(o, "shiftId"), weekId: r.str(o, "weekId"), locationId: r.str(o, "locationId"), shiftVersion: r.int(o, "shiftVersion"), requestedBy: r.str(o, "requestedBy"), patch,
    reason: r.str(o, "reason"), status: r.oneOf(o, "status", ["requested", "approved", "rejected"] as const), decidedBy: r.strOrNull(o, "decidedBy"), decidedAt: r.strOrNull(o, "decidedAt"),
    decisionNote: r.strOrNull(o, "decisionNote"), createdAt: r.str(o, "createdAt"),
  }
}

export function toExchange(dto: unknown): ApiExchange {
  const o = r.rec(dto, "exchange")
  return {
    id: r.str(o, "id"), kind: r.oneOf(o, "kind", ["claim", "swap"] as const), shiftId: r.str(o, "shiftId"), weekId: r.str(o, "weekId"), locationId: r.str(o, "locationId"), date: r.str(o, "date"),
    start: r.str(o, "start"), end: r.str(o, "end"), fromUserId: r.str(o, "fromUserId"), toUserId: r.strOrNull(o, "toUserId"), status: r.oneOf(o, "status", EXCHANGE_STATUSES), note: r.str(o, "note"),
    decidedBy: r.strOrNull(o, "decidedBy"), decidedAt: r.strOrNull(o, "decidedAt"), createdAt: r.str(o, "createdAt"), expired: r.bool(o, "expired"),
  }
}

export function toLeave(dto: unknown): ApiLeave {
  const o = r.rec(dto, "leave")
  return {
    id: r.str(o, "id"), personId: r.str(o, "userId"), from: r.str(o, "from"), to: r.str(o, "to"), kind: r.str(o, "kind"), status: r.oneOf(o, "status", ["requested", "approved", "rejected", "cancelled"] as const),
    note: r.str(o, "note"), decidedBy: r.strOrNull(o, "decidedBy"), decidedAt: r.strOrNull(o, "decidedAt"), decisionNote: r.strOrNull(o, "decisionNote"), createdAt: r.str(o, "createdAt"),
  }
}

export function toAvailability(dto: unknown, personId: string): Availability[] {
  const o = r.rec(dto, "availability")
  return list(o.windows, (w) => {
    const x = r.rec(w, "window")
    return { personId, weekday: r.int(x, "weekday") as Weekday, from: r.str(x, "from"), to: r.str(x, "to") }
  })
}

export function toPage<T>(dto: unknown, map: (x: unknown) => T): Page<T> {
  const o = r.rec(dto, "page")
  return { items: list(o.items, map), nextCursor: r.strOrNull(o, "nextCursor") }
}

function toMineShift(dto: unknown): MineShift {
  const o = r.rec(dto, "mineShift")
  return {
    id: r.str(o, "id"), date: r.str(o, "date"), start: r.str(o, "start"), end: r.str(o, "end"), startAt: r.str(o, "startAt"), endAt: r.str(o, "endAt"), unpaidBreakMin: r.int(o, "unpaidBreakMin"),
    role: r.str(o, "role"), shiftType: r.str(o, "shiftType"), confirmedAt: r.strOrNull(o, "confirmedAt"), version: r.int(o, "version"), locationId: r.str(o, "locationId"),
    locationName: r.str(o, "locationName"), locationAddress: r.str(o, "locationAddress"), timeZone: r.str(o, "timeZone"),
  }
}
/** GET /v1/roster/mine; availability and leave are fetched separately and added by the loader. */
export function toMine(dto: unknown, availability: Availability[] = [], leave: ApiLeave[] = []): MyRoster {
  const o = r.rec(dto, "mine")
  return { from: r.str(o, "from"), to: r.str(o, "to"), shifts: list(o.items, toMineShift), truncated: r.bool(o, "truncated"), availability, leave, access: toAccess(o.access) }
}

export function toRules(dto: unknown, etag: string | null): RulesView {
  const o = r.rec(dto, "rules")
  const sev = r.rec(o.severity, "severity")
  const severity: RulesView["severity"] = {}
  for (const k of Object.keys(sev)) severity[k] = r.oneOf(sev, k, ["block", "warn", "ignore"] as const)
  return { severity, avgWeekReferenceWeeks: r.int(o, "avgWeekReferenceWeeks"), draftWarnDays: r.int(o, "draftWarnDays"), etag }
}

export function toTemplate(dto: unknown): WeekTemplateSummary {
  const o = r.rec(dto, "template")
  return { id: r.str(o, "id"), locationId: r.str(o, "locationId"), name: r.str(o, "name"), shifts: r.int(o, "shifts"), createdAt: r.str(o, "createdAt"), createdBy: r.strOrNull(o, "createdBy") }
}

export function toCoverage(dto: unknown): Coverage {
  const o = r.rec(dto, "coverage")
  return {
    from: r.str(o, "from"), to: r.str(o, "to"),
    locations: list(o.locations, (l) => {
      const x = r.rec(l, "coverageLocation")
      return {
        locationId: r.str(x, "locationId"), name: r.str(x, "name"),
        days: list(x.days, (d) => {
          const y = r.rec(d, "coverageDay")
          return {
            date: r.str(y, "date"), weekId: r.str(y, "weekId"), status: r.oneOf(y, "status", ["draft", "published"] as const), staff: r.int(y, "staff"), target: r.int(y, "target"),
            short: r.int(y, "short"), over: r.int(y, "over"), open: r.int(y, "open"),
          }
        }),
      }
    }),
  }
}

function toConflict(dto: unknown): RepeatConflict {
  const o = r.rec(dto, "conflict")
  return { weekId: r.str(o, "weekId"), shiftId: r.str(o, "shiftId"), personId: r.str(o, "personId"), date: r.str(o, "date"), reason: r.str(o, "reason"), open: r.bool(o, "open"), message: r.str(o, "message") }
}
function toCounts(dto: unknown): RepeatCounts {
  const o = r.rec(dto, "counts")
  return { copied: r.int(o, "copied"), kept: r.int(o, "kept"), warned: r.int(o, "warned"), opened: r.int(o, "opened") }
}
/** POST repeat answer: the weeks made, a line per conflict, and the counts (copied = kept + warned + opened). */
export function toRepeat(dto: unknown): { created: WeekRoster[]; conflicts: RepeatConflict[]; counts: RepeatCounts } {
  const o = r.rec(dto, "repeat")
  return { created: list(o.created, toWeek), conflicts: list(o.conflicts, toConflict), counts: toCounts(o.counts) }
}
export function toApplied(dto: unknown): { week: WeekRoster; conflicts: RepeatConflict[]; counts: RepeatCounts } {
  const o = r.rec(dto, "applied")
  return { week: toWeek(o.week), conflicts: list(o.conflicts, toConflict), counts: toCounts(o.counts) }
}
