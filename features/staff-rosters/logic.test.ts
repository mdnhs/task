import { describe, expect, it } from "vitest"

import { createIncident, gapsFromOpenShifts, gapHref, incidentSchema, nextIncidentId, rostersHref, rostersTab, updateGapCover } from "./logic"
import type { Incident, RosterGap, StaffMember } from "./types"

const staff: StaffMember[] = [{ id: "s1", name: "Ana Silva", role: "Cleaner", dept: "Cleaning" }]
const h = { at: "2026-10-20T09:00:00", by: "Daniel Okafor", action: "Incident logged" }
const input = { type: "callout" as const, staff: "Ana Silva", site: "Shoreditch", client: "Acme", shift: "22:00–06:00", action: "Find cover", contact: "", notes: "" }

describe("rostersTab / hrefs", () => {
  it("only gaps maps to the gaps tab", () => {
    expect(rostersTab("gaps")).toBe("gaps")
    expect(rostersTab("attendance")).toBe("attendance")
    expect(rostersTab(["gaps"])).toBe("attendance")
    expect(rostersTab(undefined)).toBe("attendance")
  })
  it("builds return and detail links", () => {
    expect(rostersHref("gaps")).toBe("/staff-rosters?tab=gaps")
    expect(rostersHref("attendance")).toBe("/staff-rosters")
    expect(gapHref("GAP 1/2")).toBe("/staff-rosters/gaps/GAP%201%2F2")
  })
})

describe("incidents", () => {
  it("numbers one above the highest id", () => {
    expect(nextIncidentId([])).toBe("INC-1")
    expect(nextIncidentId([{ id: "INC-3003" }, { id: "INC-3010" }, { id: "x" }])).toBe("INC-3011")
  })
  it("creates an open incident with the staff dept and optional fields only when given", () => {
    const prev = [{ id: "INC-3003" }] as Incident[]
    const i = createIncident(prev, input, staff, h)
    expect(i).toMatchObject({ id: "INC-3004", dept: "Cleaning", status: "open", cover: null, owner: "Daniel Okafor", reportedAt: h.at, history: [h] })
    expect("contact" in i).toBe(false)
    expect(createIncident(prev, { ...input, contact: "0770", notes: "n" }, staff, h)).toMatchObject({ contact: "0770", notes: "n" })
  })
  it("validates the form", () => {
    expect(incidentSchema.safeParse(input).success).toBe(true)
    const bad = incidentSchema.safeParse({ ...input, staff: "", site: "x" })
    expect(bad.success).toBe(false)
    expect(bad.error?.issues.map((i) => i.path[0])).toEqual(["staff", "site"])
  })
})

describe("updateGapCover", () => {
  const g = { id: "GAP-512", coverage: "uncovered", assigned: "", nextAction: "Call agency", history: [] } as unknown as RosterGap
  it("applies the cover and appends a history note", () => {
    const out = updateGapCover(g, { coverage: "partial", assigned: "Ana Silva", nextAction: "Find a second" }, h.at, h.by)
    expect(out).toMatchObject({ coverage: "partial", assigned: "Ana Silva", nextAction: "Find a second" })
    expect(out.history).toEqual([{ at: h.at, by: h.by, action: "Cover updated", note: "Partly covered, Ana Silva" }])
    expect(updateGapCover(g, { coverage: "uncovered", assigned: "", nextAction: "Call" }, h.at, h.by).history[0].note).toBe("Uncovered")
  })
})

describe("gapsFromOpenShifts", () => {
  const loc = [{ id: "loc-a", name: "Coppers", address: "", pin: { lat: 0, lng: 0 }, zoneRadiusM: 1, openingHours: "", contact: "", swapApprovalDelegated: false }]
  const tpl = [{ id: "t1", locationId: "loc-a", name: "Door", start: "18:00", end: "02:00", unpaidBreakMin: 0, role: "Security Officer", requires: [] }]
  const wk = (id: string, status: "draft" | "published") => ({ id, locationId: "loc-a", weekStart: "2026-10-19", status, publishedAt: null, publishedBy: null, autoRepeatDays: null })
  const sh = (id: string, weekId: string, personId: string | null, date = "2026-10-21") => ({ id, weekId, locationId: "loc-a", date, personId, templateId: "t1", role: "Security Officer", start: "18:00", end: "02:00", unpaidBreakMin: 0, confirmedAt: null })
  it("derives uncovered gaps from open shifts in published weeks only", () => {
    const g = gapsFromOpenShifts([sh("a", "w1", null), sh("b", "w1", "p-x"), sh("c", "w2", null)], [wk("w1", "published"), wk("w2", "draft")], tpl, loc, "2026-10-20")
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ rosterShiftId: "a", coverage: "uncovered", when: "tomorrow", shiftStart: "2026-10-21T18:00:00", site: "Coppers", rosterHref: "/rosters?location=loc-a&week=2026-10-19" })
  })
  it("drops past shifts when today is given", () => {
    expect(gapsFromOpenShifts([sh("a", "w1", null, "2026-10-19")], [wk("w1", "published")], tpl, loc, "2026-10-20")).toHaveLength(0)
  })
})
