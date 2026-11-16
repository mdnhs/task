import { describe, expect, it } from "vitest"
import { canSeeLocation, rosterAccess, seesAllLocations } from "./roster-access"
import type { Access, Module, Role } from "./types"

const role = (over: Partial<Role> & { roster: Access }): Role => {
  const { roster, ...rest } = over
  return { id: "r", label: "r", description: "", home: "manager", access: { roster } as Record<Module, Access>, ...rest }
}
const locs = ["loc-a", "loc-b", "loc-c"]

describe("rosterAccess", () => {
  it("office role sees everything and edits published weeks", () => {
    const a = rosterAccess(role({ roster: "write", rosterLevel: "office" }), "p-x", [], [], locs)
    expect(a).toMatchObject({ scope: "all", editDraft: true, editPublished: true, approve: true })
    expect(a.locationIds).toEqual(locs)
  })
  it("roster manager with an except list loses that location", () => {
    const a = rosterAccess(role({ roster: "write", rosterLevel: "office" }), "p-priya", [], [{ personId: "p-priya", except: ["loc-a"] }], locs)
    expect(a.locationIds).toEqual(["loc-b", "loc-c"])
    expect(canSeeLocation(a, "loc-a")).toBe(false)
    expect(canSeeLocation(a, "loc-b")).toBe(true)
  })
  it("supervisor with one grant", () => {
    const a = rosterAccess(role({ roster: "write", rosterLevel: "supervisor" }), "p-ismail", [{ locationId: "loc-b", personId: "p-ismail" }, { locationId: "loc-c", personId: "p-other" }], [], locs)
    expect(a).toMatchObject({ scope: "locations", locationIds: ["loc-b"], editDraft: true, editPublished: false, approve: false })
    expect(canSeeLocation(a, "loc-c")).toBe(false)
  })
  it("supervisor with no grants sees no location", () => {
    const a = rosterAccess(role({ roster: "write", rosterLevel: "supervisor" }), "p-ismail", [], [], locs)
    expect(a.locationIds).toEqual([])
    expect(canSeeLocation(a, "loc-a")).toBe(false)
  })
  it("manager-home read role sees all, read only", () => {
    const a = rosterAccess(role({ roster: "read" }), "p-x", [], [], locs)
    expect(a).toMatchObject({ scope: "all", editDraft: false, editPublished: false, approve: false })
    expect(a.locationIds).toEqual(locs)
  })
  it("staff-home role sees only their own", () => {
    const a = rosterAccess(role({ roster: "read", home: "staff" }), "p-daniel", [], [], locs)
    expect(a).toMatchObject({ scope: "own", locationIds: null, editDraft: false, editPublished: false, approve: false })
  })
  it("no access means none", () => {
    const a = rosterAccess(role({ roster: "none", platform: true }), "p-x", [], [], locs)
    expect(a).toMatchObject({ scope: "none", locationIds: [], editDraft: false })
    expect(canSeeLocation(a, "loc-a")).toBe(false)
  })
})

describe("seesAllLocations", () => {
  it("is false for a cut office role and a supervisor, true for a full office role", () => {
    const office = role({ roster: "write", rosterLevel: "office" })
    expect(seesAllLocations(rosterAccess(office, "p-a", [], [], locs), locs)).toBe(true)
    expect(seesAllLocations(rosterAccess(office, "p-a", [], [{ personId: "p-a", except: [locs[0]] }], locs), locs)).toBe(false)
    expect(seesAllLocations(rosterAccess(role({ roster: "write", rosterLevel: "supervisor" }), "p-a", locs.map((l) => ({ locationId: l, personId: "p-a" })), [], locs), locs)).toBe(false)
  })
})
