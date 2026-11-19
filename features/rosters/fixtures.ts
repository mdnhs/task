// API DTO fixtures for the roster client tests (the examples of api/src/modules/rosters/dto.ts).
export const LID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
export const STID = "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90"
export const WEEK_ID = "5d8b2f4a-1c3e-4a7b-8f60-9e2d1c0b3a44"
export const SHIFT_ID = "9a1c6b3e-2d4f-4e58-b7a9-1f3c5d7e9b02"
export const UID = "usr_8Kq2mZ4tW1"

export const locationDto = { id: LID, name: "Harbour Street", address: "1 Harbour Street, Dublin", lat: 53.3498, lng: -6.2603, zoneRadiusM: 150, openingHours: { mon: "08:00-22:00" }, contact: "+353 1 555 0100", swapApprovalDelegated: false, timeZone: null, version: 1, archived: false, supervisorIds: [UID] }
export const shiftTypeDto = { id: STID, locationId: LID, name: "Night", start: "22:00", end: "06:00", unpaidBreakMin: 30, role: "Security officer", requires: ["SIA licence"], targets: [{ weekday: 1, count: 2 }], archived: false, version: 1 }
export const shiftDto = { id: SHIFT_ID, weekId: WEEK_ID, locationId: LID, date: "2026-11-02", userId: UID, shiftTypeId: STID, role: "Security officer", start: "22:00", end: "06:00", unpaidBreakMin: 30, startAt: "2026-11-02T22:00:00.000Z", endAt: "2026-11-03T06:00:00.000Z", confirmedAt: null, version: 1 }
export const weekDto = { id: WEEK_ID, locationId: LID, weekStart: "2026-11-02", status: "draft", publishedAt: null, publishedBy: null, autoRepeatDays: null, version: 1, days: [{ date: "2026-11-02", shiftIds: [SHIFT_ID], count: 1, target: 2, short: 1, over: 0 }] }
export const weeksDto = { range: { from: "2026-11-02", to: "2026-11-08", view: "week" }, weeks: [weekDto], shifts: [shiftDto], shiftTypes: [shiftTypeDto], members: [{ userId: UID, name: "Aoife Byrne", active: true, homeLocationId: LID }], membersTruncated: false }
export const violationDto = { rule: "daily_rest", shiftId: SHIFT_ID, personId: UID, severity: "warn", message: "Aoife Byrne has only 10h00 rest", otherShiftIds: [] }
export const mineShiftDto = { id: SHIFT_ID, date: "2026-11-16", start: "08:00", end: "16:00", startAt: "2026-11-16T08:00:00.000Z", endAt: "2026-11-16T16:00:00.000Z", unpaidBreakMin: 30, role: "Security officer", shiftType: "Day", confirmedAt: null, version: 2, locationId: LID, locationName: "Harbour Street", locationAddress: "1 Harbour Street, Dublin", timeZone: "Europe/Dublin" }
export const leaveDto = { id: "3f2b8c1d-6a47-4e0b-9d15-2c7e5a9b4f10", userId: UID, from: "2026-12-01", to: "2026-12-05", kind: "annual", status: "requested", note: "Family trip", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-11-16T09:00:00.000Z" }
export const exchangeDto = { id: "6b2d9f41-7c3a-4e85-b0d2-5a8e1f3c9d64", kind: "claim", shiftId: SHIFT_ID, weekId: WEEK_ID, locationId: LID, date: "2026-11-23", start: "08:00", end: "16:00", fromUserId: UID, toUserId: null, status: "requested", note: "", decidedBy: null, decidedAt: null, createdAt: "2026-11-16T09:00:00.000Z", expired: false }
export const changeRequestDto = { id: "4e7a1d93-b2c5-4f08-a6d1-83c9e0f57b12", shiftId: SHIFT_ID, weekId: WEEK_ID, locationId: LID, shiftVersion: 2, requestedBy: UID, patch: { start: "09:00", end: "17:00" }, reason: "Venue opens late", status: "requested", decidedBy: null, decidedAt: null, decisionNote: null, createdAt: "2026-11-16T09:00:00.000Z" }
export const historyDto = { id: SHIFT_ID, at: "2026-11-16T09:00:00.000Z", actorId: UID, action: "shift_moved", locationId: LID, weekId: WEEK_ID, shiftId: SHIFT_ID, reason: "Cover", before: { start: "08:00" }, after: { start: "09:00" } }
export const rulesDto = { severity: { double_booking: "block", daily_rest: "warn" }, avgWeekReferenceWeeks: 17, draftWarnDays: 3 }
