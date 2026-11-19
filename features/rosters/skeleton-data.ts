import { dayColumns } from "@/lib/rosters"
import { toWeeksPayload } from "./adapters"
import type { HistoryEntry, MineShift, MyRoster, RosterLocation, RosterMember, RosterPayload, ShiftType, WeekTemplateSummary } from "./types"
import type { RosterPanels } from "./components/rosters-view"

// The TYPICAL week the loading skeleton draws (B6 ruling I9: a loading.tsx knows nothing from the API or the session). One location, a draft week the caller may edit, seven day columns with a full
// day's cards. The real page then replaces it; a role with less access (no Manage locations link, no add buttons) or a different roster sees a small layout change, never a delay.
// No tenant data: the names are placeholders and the SkMask hides every glyph anyway.
const MONDAY = "2026-11-02"
const LOCATION = "00000000-0000-4000-8000-0000000000a1"
const WEEK = "00000000-0000-4000-8000-0000000000b1"
const TYPE = "00000000-0000-4000-8000-0000000000c1"
const PEOPLE = ["u1", "u2", "u3", "u4", "u5", "u6"]
const day = (i: number) => new Date(Date.UTC(2026, 10, 2 + i)).toISOString().slice(0, 10)
// The demo roster's typical week (measured): two people a day, three on Friday, four on Saturday (an open shift among them). At 1568 the busiest column sets the height, at 390 the days stack, so both are matched.
const PER_DAY = [2, 2, 2, 2, 3, 4, 2]

export function skeletonPayload(): RosterPayload {
  const shifts = PER_DAY.flatMap((count, d) => Array.from({ length: count }, () => day(d))).map((date, n) => ({
    id: `s${n}`, weekId: WEEK, locationId: LOCATION, date, userId: PEOPLE[n % PEOPLE.length]!, shiftTypeId: TYPE, role: "Security officer", start: "08:00", end: "16:00", unpaidBreakMin: 30,
    startAt: `${date}T08:00:00.000Z`, endAt: `${date}T16:00:00.000Z`, confirmedAt: null, version: 1,
  }))
  const type = { id: TYPE, locationId: LOCATION, name: "Day", start: "08:00", end: "16:00", unpaidBreakMin: 30, role: "Security officer", requires: [], targets: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, count: 4 })), archived: false, version: 1 }
  const access = { level: "office", canEdit: true, locked: false, lockReason: null } as const
  const week = { id: WEEK, locationId: LOCATION, weekStart: MONDAY, status: "draft" as const, publishedAt: null, publishedBy: null, autoRepeatDays: null }
  const cols = dayColumns(week, shifts.map((s) => ({ id: s.id, weekId: WEEK, locationId: LOCATION, date: s.date, personId: s.userId, templateId: TYPE, role: s.role, start: s.start, end: s.end, unpaidBreakMin: 30, confirmedAt: null })), type.targets.map((t) => ({ locationId: LOCATION, templateId: TYPE, weekday: t.weekday as 0, count: t.count })), [{ id: TYPE, locationId: LOCATION, name: "Day", start: "08:00", end: "16:00", unpaidBreakMin: 30, role: "Security officer", requires: [] }])
  const location = { id: LOCATION, name: "Location name", address: "Address", lat: null, lng: null, zoneRadiusM: null, openingHours: {}, contact: "", swapApprovalDelegated: false, timeZone: null, version: 1, archived: false, supervisorIds: [] }
  // The typical office caller sees several locations, so the filter bar has its Location switcher (it wraps onto its own row on a phone); a one-location supervisor has none (a small, known difference).
  const more = [2, 3].map((n) => ({ ...location, id: `00000000-0000-4000-8000-0000000000a${n}`, name: `Location name ${n}` }))
  return toWeeksPayload(
    {
      range: { from: MONDAY, to: day(6), view: "week" }, weeks: [{ ...week, version: 1, access, days: cols.map((c) => ({ date: c.date, shiftIds: c.shifts.map((s) => s.id), count: c.count, target: c.target, short: c.short, over: c.over })) }], shifts, shiftTypes: [type],
      members: PEOPLE.map((id, i) => ({ userId: id, name: `Person name ${i + 1}`, active: true, homeLocationId: LOCATION })), membersTruncated: false, access,
    },
    [location, ...more],
  )
}
export const SKELETON_TODAY = "2026-11-02T09:00:00"

/** Two saved templates, as the demo roster has: the panel under the week is part of the page's height. */
export function skeletonTemplates(): WeekTemplateSummary[] {
  return [0, 1].map((i) => ({ id: `t${i}`, locationId: LOCATION, name: "Template name", shifts: 12, createdAt: "2026-11-01T00:00:00.000Z", createdBy: null }))
}

/** The panels of the typical page (the demo roster): a page of history (a week with change requests or open shifts adds its own panels: a known, recorded ceiling). Placeholder text only; the mask hides every glyph. */
export function skeletonPanels(): RosterPanels {
  const hist = (i: number): HistoryEntry => ({ id: `h${i}`, weekId: WEEK, locationId: LOCATION, shiftId: null, at: "2026-11-01T09:00:00.000Z", by: "u1", action: "shift_moved", before: null, after: null, reason: null })
  return { requests: [], exchanges: [], history: { weekId: WEEK, page: { items: Array.from({ length: 18 }, (_, i) => hist(i)), nextCursor: null } }, gapsLink: false }
}

// ---- Locations admin and My roster (B8 Task 22). Static and synthetic like the week above: no API, no session, no first-location data (a loading.tsx gets no params, K1).
const site = (n: number) => ({ ...skeletonPayload().locations[0]!, id: `00000000-0000-4000-8000-0000000000a${n}`, name: `Location name ${n}`, address: "Street address, City", zoneRadiusM: 150, supervisorIds: ["u1"] })

/** The typical office list: three sites (one address long enough to wrap on a phone, as the demo's quay address does), one supervisor each, and the people the licence editor picks from. */
export function skeletonLocations(): { locations: RosterLocation[]; people: RosterMember[] } {
  const addresses = ["Street address, City 2", "Long street name on the quay, City 2", "Road name, City 12"]
  return { locations: [1, 2, 3].map((n) => ({ ...site(n), address: addresses[n - 1]! })), people: [{ id: "u1", name: "Person name", active: true, homeLocationId: null }] }
}

/** The typical location form: an existing site with the demo's common two shift types (Day and Night), a week of opening hours and one supervisor. */
export function skeletonLocationForm(): { location: RosterLocation; shiftTypes: ShiftType[]; people: RosterMember[] } {
  const location = { ...site(1), lat: 53.3, lng: -6.2, contact: "Phone number", openingHours: Object.fromEntries(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [d, "12:00-03:30"])) }
  const type = (n: number, name: string, start: string, end: string): ShiftType => ({
    id: `00000000-0000-4000-8000-0000000000c${n}`, locationId: location.id, name, start, end, unpaidBreakMin: 30, role: "Security officer", requires: ["sia licence"],
    targets: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday: weekday as 0, count: 2 })), archived: false, version: 1,
  })
  return { location, shiftTypes: [type(1, "Day", "08:00", "16:00"), type(2, "Night", "22:00", "06:00")], people: [{ id: "u1", name: "Person name", active: true, homeLocationId: null }] }
}

/**
 * The typical My roster of the OFFICE caller (K4: a loading.tsx draws the typical owner/office view): the calendar tab, nothing coming up, nothing to confirm, no requests. Staff with shifts
 * see taller summary tiles (a recorded CEILING); the calendar grid is the same height either way (six fixed rows).
 */
export function skeletonMyRoster(): MyRoster {
  return {
    from: "2026-10-05", to: "2027-01-31", shifts: [] as MineShift[], truncated: false, availability: [], leave: [],
    access: { level: "office", canEdit: true, locked: false, lockReason: "reason_required" },
  }
}
export const SKELETON_NOW = "2026-11-02T09:00:00.000Z"
