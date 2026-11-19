import { dayColumns } from "@/lib/rosters"
import { toWeeksPayload } from "./adapters"
import type { RosterPayload, WeekAccess } from "./types"

// API DTO fixtures for the roster client tests (the examples of api/src/modules/rosters/dto.ts).
export const LID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
export const STID = "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90"
export const WEEK_ID = "5d8b2f4a-1c3e-4a7b-8f60-9e2d1c0b3a44"
export const SHIFT_ID = "9a1c6b3e-2d4f-4e58-b7a9-1f3c5d7e9b02"
export const UID = "usr_8Kq2mZ4tW1"

export const locationDto = { id: LID, name: "Harbour Street", address: "1 Harbour Street, Dublin", lat: 53.3498, lng: -6.2603, zoneRadiusM: 150, openingHours: { mon: "08:00-22:00" }, contact: "+353 1 555 0100", swapApprovalDelegated: false, timeZone: null, version: 1, archived: false, supervisorIds: [UID] }
export const shiftTypeDto = { id: STID, locationId: LID, name: "Night", start: "22:00", end: "06:00", unpaidBreakMin: 30, role: "Security officer", requires: ["SIA licence"], targets: [{ weekday: 1, count: 2 }], archived: false, version: 1 }
export const shiftDto = { id: SHIFT_ID, weekId: WEEK_ID, locationId: LID, date: "2026-11-02", userId: UID, shiftTypeId: STID, role: "Security officer", start: "22:00", end: "06:00", unpaidBreakMin: 30, startAt: "2026-11-02T22:00:00.000Z", endAt: "2026-11-03T06:00:00.000Z", confirmedAt: null, version: 1 }
export const openAccess = { level: "supervisor", canEdit: true, locked: false, lockReason: null } as const
export const lockedAccess = { level: "supervisor", canEdit: false, locked: true, lockReason: "roster_locked" } as const
export const weekDto = { id: WEEK_ID, locationId: LID, weekStart: "2026-11-02", status: "draft", publishedAt: null, publishedBy: null, autoRepeatDays: null, version: 1, days: [{ date: "2026-11-02", shiftIds: [SHIFT_ID], count: 1, target: 2, short: 1, over: 0 }], access: openAccess }
export const weeksDto = { range: { from: "2026-11-02", to: "2026-11-08", view: "week" }, weeks: [weekDto], shifts: [shiftDto], shiftTypes: [shiftTypeDto], members: [{ userId: UID, name: "Aoife Byrne", active: true, homeLocationId: LID }], membersTruncated: false, access: openAccess }
export const violationDto = { rule: "daily_rest", shiftId: SHIFT_ID, personId: UID, severity: "warn", message: "Aoife Byrne has only 10h00 rest", otherShiftIds: [] }
export const mineShiftDto = { id: SHIFT_ID, date: "2026-11-16", start: "08:00", end: "16:00", startAt: "2026-11-16T08:00:00.000Z", endAt: "2026-11-16T16:00:00.000Z", unpaidBreakMin: 30, role: "Security officer", shiftType: "Day", confirmedAt: null, version: 2, locationId: LID, locationName: "Harbour Street", locationAddress: "1 Harbour Street, Dublin", timeZone: "Europe/Dublin" }
export const leaveDto = { id: "3f2b8c1d-6a47-4e0b-9d15-2c7e5a9b4f10", userId: UID, from: "2026-12-01", to: "2026-12-05", kind: "annual", status: "requested", note: "Family trip", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-11-16T09:00:00.000Z" }
export const exchangeDto = { id: "6b2d9f41-7c3a-4e85-b0d2-5a8e1f3c9d64", kind: "claim", shiftId: SHIFT_ID, weekId: WEEK_ID, locationId: LID, date: "2026-11-23", start: "08:00", end: "16:00", fromUserId: UID, toUserId: null, status: "requested", note: "", decidedBy: null, decidedAt: null, createdAt: "2026-11-16T09:00:00.000Z", expired: false }
export const changeRequestDto = { id: "4e7a1d93-b2c5-4f08-a6d1-83c9e0f57b12", shiftId: SHIFT_ID, weekId: WEEK_ID, locationId: LID, shiftVersion: 2, requestedBy: UID, patch: { start: "09:00", end: "17:00" }, reason: "Venue opens late", status: "requested", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-11-16T09:00:00.000Z" }
export const historyDto = { id: SHIFT_ID, at: "2026-11-16T09:00:00.000Z", actorId: UID, action: "shift_moved", locationId: LID, weekId: WEEK_ID, shiftId: SHIFT_ID, reason: "Cover", before: { start: "08:00" }, after: { start: "09:00" } }
export const rulesDto = { severity: { double_booking: "block", daily_rest: "warn" }, avgWeekReferenceWeeks: 17, draftWarnDays: 3 }

// ---- a whole week for the view and editor tests (built through the adapters, so it has exactly the shape the pages get) ----
export const LID2 = "8d1f7a2b-3c4e-4b6a-9f10-2e3d4c5b6a71"
const wk = (n: number) => `2026-11-${String(2 + n).padStart(2, "0")}`
const type = (id: string, locationId: string, name: string, start: string, end: string) => ({ id, locationId, name, start, end, unpaidBreakMin: 30, role: "Security officer", requires: [], targets: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ weekday: d, count: 2 })), archived: false, version: 1 })
export const DAY_T = "11111111-0000-4000-8000-000000000001"
export const NIGHT_T = "11111111-0000-4000-8000-000000000002"
export const PERSON = { ann: "usr_Ann", ben: "usr_Ben", cara: "usr_Cara" }
const sh = (id: string, date: string, userId: string | null, typeId: string, start: string, end: string, version = 1) => ({ id, weekId: WEEK_ID, locationId: LID, date, userId, shiftTypeId: typeId, role: "Security officer", start, end, unpaidBreakMin: 30, startAt: `${date}T${start}:00.000Z`, endAt: `${date}T${end}:00.000Z`, confirmedAt: null, version })
export const SHIFTS = [
  sh("sh-mon-ann", wk(0), PERSON.ann, DAY_T, "08:00", "16:00"),
  sh("sh-mon-ben", wk(0), PERSON.ben, DAY_T, "14:00", "22:00"), // a different start and end on the same day
  sh("sh-tue-cara", wk(1), PERSON.cara, NIGHT_T, "22:00", "06:00"),
  sh("sh-wed-open", wk(2), null, DAY_T, "08:00", "16:00"),
]

/** A draft week of one location (7 day columns, counts against a target of 2 a day) in the API's shape; `access` is the week's and the payload's. */
export function payloadFixture(o: { access?: WeekAccess; status?: "draft" | "published"; locations?: string[]; shifts?: typeof SHIFTS; /** A week's own access when it differs from the payload's (a supervisor of one site, office elsewhere). */ weekAccess?: (locationId: string) => WeekAccess } = {}): RosterPayload {
  const access = o.access ?? openAccess
  const locations = (o.locations ?? [LID]).map((id) => ({ ...locationDto, id, name: id === LID ? "Coppers" : "Docklands" }))
  const shifts = o.shifts ?? SHIFTS
  const types = locations.flatMap((l) => [type(`${DAY_T}${l.id === LID ? "" : "-b"}`, l.id, "Day", "08:00", "16:00"), type(`${NIGHT_T}${l.id === LID ? "" : "-b"}`, l.id, "Night", "22:00", "06:00")])
  const weeks = locations.map((l) => {
    const id = l.id === LID ? WEEK_ID : "wk-" + l.id
    const mine = l.id === LID ? shifts : []
    const domainWeek = { id, locationId: l.id, weekStart: wk(0), status: o.status ?? "draft", publishedAt: null, publishedBy: null, autoRepeatDays: null }
    const cols = dayColumns(domainWeek, mine.map((s) => ({ id: s.id, weekId: id, locationId: l.id, date: s.date, personId: s.userId, templateId: s.shiftTypeId, role: s.role, start: s.start, end: s.end, unpaidBreakMin: 30, confirmedAt: null })),
      types.filter((t) => t.locationId === l.id).flatMap((t) => t.targets.map((x) => ({ locationId: l.id, templateId: t.id, weekday: x.weekday as 0, count: x.count }))),
      types.filter((t) => t.locationId === l.id).map((t) => ({ id: t.id, locationId: l.id, name: t.name, start: t.start, end: t.end, unpaidBreakMin: 30, role: t.role, requires: [] })))
    return { ...domainWeek, version: 1, days: cols.map((c) => ({ date: c.date, shiftIds: c.shifts.map((s) => s.id), count: c.count, target: c.target, short: c.short, over: c.over })), access: o.weekAccess?.(l.id) ?? access }
  })
  const members = [{ userId: PERSON.ann, name: "Ann Byrne", active: true, homeLocationId: LID }, { userId: PERSON.ben, name: "Ben Walsh", active: true, homeLocationId: LID }, { userId: PERSON.cara, name: "Cara Doyle", active: true, homeLocationId: LID }]
  return toWeeksPayload({ range: { from: wk(0), to: wk(6), view: "week" }, weeks, shifts, shiftTypes: types, members, membersTruncated: false, access }, locations)
}
