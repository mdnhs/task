import { describe, expect, it } from "vitest"
import { occurrenceOf } from "./shift-report"
import type { Location, RosterShift, RosterWeek, ShiftTemplate } from "./rosters"
import { overlayRoster } from "./roster-overlay"
import { shiftKey, shiftsOn, shiftsFor } from "./shifts"
import type { ShiftState } from "./shifts"

const TZ = "Europe/Dublin"
const base: ShiftState = {
  patterns: [{ id: "pat-day", name: "Day", team: "Security", start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4, 5, 6] }],
  assignments: [
    { personId: "p-marcus", patternId: "pat-day", from: "2026-10-01" },
    { personId: "p-leo", patternId: "pat-day", from: "2026-10-01" },
  ],
  members: [{ personId: "p-marcus", teams: ["Security"], managerId: null }],
  reporting: { dueAfterMinutes: 60, teamDefaults: {}, overrides: {} },
}
const locations: Location[] = [{ id: "loc-a", name: "Coppers", address: "", pin: { lat: 0, lng: 0 }, zoneRadiusM: 100, openingHours: "", contact: "", swapApprovalDelegated: false }]
const templates: ShiftTemplate[] = [{ id: "tpl-door", locationId: "loc-a", name: "Door", start: "18:00", end: "02:00", unpaidBreakMin: 30, role: "Security Officer", requires: [] }]
const week = (id: string, weekStart: string, status: "draft" | "published"): RosterWeek => ({ id, locationId: "loc-a", weekStart, status, publishedAt: status === "published" ? "2026-10-12T10:00:00" : null, publishedBy: null, autoRepeatDays: null })
const shift = (id: string, weekId: string, date: string, personId: string | null, over: Partial<RosterShift> = {}): RosterShift => ({
  id, weekId, locationId: "loc-a", date, personId, templateId: "tpl-door", role: "Security Officer", start: "18:00", end: "02:00", unpaidBreakMin: 30, confirmedAt: null, ...over,
})
const weeks = [week("w1", "2026-10-19", "published"), week("w2", "2026-10-26", "draft")]

describe("overlayRoster", () => {
  it("turns a published assigned shift into a one-day pattern and assignment with its own times", () => {
    const out = overlayRoster(base, weeks, [shift("rs-1", "w1", "2026-10-20", "p-marcus", { start: "19:30", end: "03:00" })], templates, locations)
    const p = out.patterns.find((x) => x.id === "rs-1")!
    expect(p).toMatchObject({ start: "19:30", end: "03:00", days: [2] })
    expect(out.assignments).toContainEqual({ personId: "p-marcus", patternId: "rs-1", from: "2026-10-20", until: "2026-10-20" })
    const on = shiftsOn("2026-10-20", out.patterns, out.assignments, TZ).filter((o) => o.pattern.id === "rs-1")
    expect(on).toHaveLength(1)
    expect(on[0].window.start).toBe("2026-10-20T19:30")
    expect(on[0].window.end).toBe("2026-10-21T03:00")
  })
  it("ignores drafts and open shifts", () => {
    const out = overlayRoster(base, weeks, [shift("rs-2", "w2", "2026-10-27", "p-marcus"), shift("rs-3", "w1", "2026-10-21", null)], templates, locations)
    expect(out.patterns).toEqual(base.patterns)
    expect(out.assignments).toEqual(base.assignments)
  })
  it("a person in a draft week keeps the pattern", () => {
    const out = overlayRoster(base, weeks, [shift("rs-2", "w2", "2026-10-27", "p-marcus")], templates, locations)
    expect(shiftsFor("p-marcus", "2026-10-26", "2026-11-01", out.patterns, out.assignments, TZ)).toHaveLength(7)
  })
  it("carves the pattern out for the rostered week only", () => {
    const out = overlayRoster(base, weeks, [shift("rs-1", "w1", "2026-10-20", "p-marcus")], templates, locations)
    const days = (from: string, to: string, who: string) => shiftsFor(who, from, to, out.patterns, out.assignments, TZ).filter((o) => o.pattern.id === "pat-day").length
    expect(days("2026-10-19", "2026-10-25", "p-marcus")).toBe(0)
    expect(days("2026-10-12", "2026-10-18", "p-marcus")).toBe(7)
    expect(days("2026-10-26", "2026-11-01", "p-marcus")).toBe(7)
    expect(days("2026-10-19", "2026-10-25", "p-leo")).toBe(7)
  })
  it("gives two shifts on one day two keys, and reports still resolve", () => {
    const out = overlayRoster(base, weeks, [shift("rs-1", "w1", "2026-10-20", "p-marcus", { start: "10:00", end: "14:00" }), shift("rs-4", "w1", "2026-10-20", "p-marcus", { start: "18:00", end: "22:00" })], templates, locations)
    const occ = shiftsOn("2026-10-20", out.patterns, out.assignments, TZ).filter((o) => o.personId === "p-marcus")
    const keys = occ.map((o) => shiftKey(o.personId, o.window))
    expect(new Set(keys).size).toBe(2)
    for (const k of keys) expect(occurrenceOf(k, out, TZ)).not.toBeNull()
    expect(occurrenceOf("p-marcus:rs-4:2026-10-20", out, TZ)?.window.start).toBe("2026-10-20T18:00")
  })
  it("existing report ids still resolve", () => {
    const out = overlayRoster(base, weeks, [shift("rs-1", "w1", "2026-10-20", "p-marcus")], templates, locations)
    expect(occurrenceOf("p-leo:pat-day:2026-10-22", out, TZ)).not.toBeNull()
  })
  it("does not mutate the input", () => {
    const copy = JSON.stringify(base)
    overlayRoster(base, weeks, [shift("rs-1", "w1", "2026-10-20", "p-marcus")], templates, locations)
    expect(JSON.stringify(base)).toBe(copy)
  })
})
