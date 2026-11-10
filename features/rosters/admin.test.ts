import { describe, expect, it } from "vitest"
import type { LocationGrant } from "@/lib/roster-access"
import type { HistoryEntry, RosterShift } from "@/lib/rosters"
import type { WorkforceMember } from "@/lib/workforce"
import { assignableMembers, canDeleteTemplate, resolveMember, setSupervisors, supervisorHistory, validateLocation, type LocationForm } from "./admin"

const shift = (id: string, templateId: string): RosterShift => ({ id, weekId: "w", locationId: "L", date: "2026-10-20", personId: null, templateId, role: "r", start: "09:00", end: "17:00", unpaidBreakMin: 0, confirmedAt: null })
const member = (id: string, leftOn: string | null = null): WorkforceMember => ({ id, name: id, role: "r", dept: "d", homeLocationId: null, qualifications: [], leftOn })
const form = (patch: Partial<LocationForm> = {}): LocationForm => ({ name: "Site", address: "1 Road", lat: "53.3", lng: "-6.2", radius: "150", openingHours: "Mon-Sun", contact: "01", ...patch })

describe("canDeleteTemplate", () => {
  it("refuses a template any shift uses, allows an unused one", () => {
    const shifts = [shift("a", "t1"), shift("b", "t2")]
    expect(canDeleteTemplate("t1", shifts)).toBe(false)
    expect(canDeleteTemplate("t3", shifts)).toBe(true)
  })
})

describe("setSupervisors", () => {
  const grants: LocationGrant[] = [{ locationId: "L", personId: "a" }, { locationId: "L", personId: "b" }, { locationId: "M", personId: "a" }]
  it("reports who was added and removed and leaves other locations alone", () => {
    const r = setSupervisors(grants, "L", ["b", "c"])
    expect(r.added).toEqual(["c"])
    expect(r.removed).toEqual(["a"])
    expect(r.grants.filter((g) => g.locationId === "L").map((g) => g.personId).sort()).toEqual(["b", "c"])
    expect(r.grants).toContainEqual({ locationId: "M", personId: "a" })
  })
  it("reports nothing for an unchanged list", () => {
    const r = setSupervisors(grants, "L", ["b", "a"])
    expect(r.added).toEqual([])
    expect(r.removed).toEqual([])
    expect(r.grants).toHaveLength(3)
  })
})

describe("supervisorHistory (FR-RS-34)", () => {
  it("is a location-level entry with the before and after lists, or null when nothing changed", () => {
    const e = supervisorHistory("L", ["a"], ["a", "b"], "p-x", "2026-10-21T09:00:00", [] as HistoryEntry[])
    expect(e).toMatchObject({ weekId: null, shiftId: null, locationId: "L", by: "p-x", action: "supervisors.changed", before: { supervisors: ["a"] }, after: { supervisors: ["a", "b"] } })
    expect(supervisorHistory("L", ["a", "b"], ["b", "a"], "p-x", "t", [])).toBeNull()
  })
})

describe("validateLocation", () => {
  it("accepts a valid form", () => expect(validateLocation(form())).toEqual({}))
  it("radius must be above 0", () => {
    expect(validateLocation(form({ radius: "0" })).radius).toBeTruthy()
    expect(validateLocation(form({ radius: "-5" })).radius).toBeTruthy()
    expect(validateLocation(form({ radius: "abc" })).radius).toBeTruthy()
    expect(validateLocation(form({ radius: "1" })).radius).toBeUndefined()
  })
  it("needs a name and a valid pin", () => {
    expect(validateLocation(form({ name: " " })).name).toBeTruthy()
    expect(validateLocation(form({ lat: "91" })).lat).toBeTruthy()
    expect(validateLocation(form({ lng: "181" })).lng).toBeTruthy()
  })
})

describe("members who have left", () => {
  const members = [member("a"), member("gone", "2026-10-31")]
  it("still resolve by id so past shifts keep the name", () => expect(resolveMember(members, "gone")?.name).toBe("gone"))
  it("are not offered for new shifts on or after the leaving date", () => {
    expect(assignableMembers(members, "2026-11-02").map((m) => m.id)).toEqual(["a"])
    expect(assignableMembers(members, "2026-10-20").map((m) => m.id)).toEqual(["a", "gone"])
  })
})
