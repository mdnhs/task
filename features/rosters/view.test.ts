import { describe, expect, it } from "vitest"
import type { RosterAccess } from "@/lib/roster-access"
import { getRosterData } from "./api"
import { rosterViewData } from "./view"

const acc = (scope: RosterAccess["scope"], locationIds: string[] | null): RosterAccess => ({ scope, locationIds, editDraft: false, editPublished: false, approve: false })
const TODAY = "2026-10-21T09:00:00"

describe("rosterViewData", () => {
  it("a supervisor asking for an ungranted location is denied", async () => {
    const a = acc("locations", ["loc-coppers"])
    const data = await getRosterData(acc("all", ["loc-coppers", "loc-docklands", "loc-liffey"]), "x")
    expect(rosterViewData(data, a, { location: "loc-docklands" }, TODAY)).toEqual({ denied: true })
    expect(rosterViewData(data, a, { location: "all" }, TODAY)).toEqual({ denied: true })
  })
  it("a supervisor's view data holds no other location's name, shift id or person", async () => {
    const a = acc("locations", ["loc-coppers"])
    const full = await getRosterData(acc("all", ["loc-coppers", "loc-docklands", "loc-liffey"]), "x") // uncut on purpose
    const v = rosterViewData(full, a, { week: "2026-10-19" }, TODAY)
    const json = JSON.stringify(v)
    const others = full.shifts.filter((s) => s.locationId !== "loc-coppers")
    expect(others.length).toBeGreaterThan(0)
    for (const s of others) expect(json).not.toContain(s.id)
    for (const l of full.locations.filter((l) => l.id !== "loc-coppers")) expect(json).not.toContain(l.name)
    const names = new Set(full.shifts.filter((s) => s.locationId === "loc-coppers").map((s) => s.personId))
    for (const s of others) if (s.personId && !names.has(s.personId)) expect(json).not.toContain(full.members.find((m) => m.id === s.personId)!.name)
  })
  it("defaults to the first permitted location and shows seven days with count and target", async () => {
    const a = acc("locations", ["loc-coppers"])
    const data = await getRosterData(a, "p-ismail")
    const v = rosterViewData(data, a, { week: "2026-10-19" }, TODAY)
    if ("denied" in v) throw new Error("denied")
    expect(v.location).toBe("loc-coppers")
    expect(v.blocks).toHaveLength(1)
    expect(v.blocks[0].days).toHaveLength(7)
    expect(v.blocks[0].status).toBe("published")
    expect(v.totals.count).toBeGreaterThan(0)
  })
  it("scope all may pick all locations; ranges and groupings follow the query", async () => {
    const a = acc("all", ["loc-coppers", "loc-docklands", "loc-liffey"])
    const data = await getRosterData(a, "x")
    const v = rosterViewData(data, a, { location: "all", week: "2026-10-19", view: "fortnight", group: "role" }, TODAY)
    if ("denied" in v) throw new Error("denied")
    expect(v.dates).toHaveLength(14)
    expect(v.locations[0].value).toBe("all")
    expect(v.groups.length).toBeGreaterThan(0)
    const m = rosterViewData(data, a, { location: "loc-coppers", week: "2026-10-21", view: "month" }, TODAY)
    if ("denied" in m) throw new Error("denied")
    expect(m.from).toBe("2026-10-01")
    expect(m.dates).toHaveLength(31)
  })
  it("no access scope is denied", async () => {
    expect(rosterViewData({ locations: [], templates: [], targets: [], weeks: [], shifts: [], members: [] }, acc("none", []), {}, TODAY)).toEqual({ denied: true })
  })
  it("a short day and an over day don't cancel out in the totals or the block", () => {
    const loc = { id: "l1", name: "Site", address: "", pin: { lat: 0, lng: 0 }, zoneRadiusM: 1, openingHours: "", contact: "", swapApprovalDelegated: false }
    const tpl = { id: "t1", locationId: "l1", name: "Day", start: "09:00", end: "17:00", unpaidBreakMin: 0, role: "Guard", requires: [] }
    const shift = (id: string, date: string, personId: string) => ({ id, weekId: "w1", locationId: "l1", date, personId, templateId: "t1", role: "Guard", start: "09:00", end: "17:00", unpaidBreakMin: 0, confirmedAt: null })
    const member = (id: string) => ({ id, name: id, role: "Guard", dept: "Security", homeLocationId: "l1", qualifications: [], leftOn: null })
    const data = {
      locations: [loc], templates: [tpl],
      targets: [{ locationId: "l1", templateId: "t1", weekday: 1 as const, count: 2 }, { locationId: "l1", templateId: "t1", weekday: 2 as const, count: 1 }],
      weeks: [{ id: "w1", locationId: "l1", weekStart: "2026-10-19", status: "draft" as const, publishedAt: null, publishedBy: null, autoRepeatDays: null }],
      shifts: [shift("a", "2026-10-20", "p1"), shift("b", "2026-10-20", "p2"), shift("c", "2026-10-20", "p3")], // Mon: 0 of 2 (short 2), Tue: 3 of 1 (over 2)
      members: ["p1", "p2", "p3"].map(member),
    }
    const v = rosterViewData(data, acc("all", ["l1"]), { location: "l1", week: "2026-10-19" }, TODAY)
    if ("denied" in v) throw new Error("denied")
    expect(v.blocks[0].days[0]).toMatchObject({ short: 2, over: 0 })
    expect(v.blocks[0].days[1]).toMatchObject({ short: 0, over: 2 })
    expect(v.blocks[0].short).toBe(2)
    expect(v.totals).toMatchObject({ count: 3, target: 3, short: 2, over: 2 })
  })
})
