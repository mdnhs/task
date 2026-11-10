import { describe, expect, it } from "vitest"
import type { RosterAccess } from "@/lib/roster-access"
import type { Location } from "@/lib/rosters"
import { exchangeScopeKey, mergeById, mergeLocations, mineScopeKey, rosterScopeKey, withNewLocations } from "./scope"
import type { Claim } from "./types"

const loc = (id: string, name = id): Location => ({ id, name, address: "", pin: { lat: 0, lng: 0 }, zoneRadiusM: 1, openingHours: "", contact: "", swapApprovalDelegated: false })
const claim = (id: string, status: Claim["status"] = "open"): Claim => ({ id, shiftId: "s", personId: "p", at: "t", status, decidedBy: null, decidedAt: null })
const office: RosterAccess = { scope: "all", locationIds: ["A"], editDraft: true, editPublished: true, approve: true }

describe("scope keys", () => {
  it("My roster shares the exchange key with the Rosters page", () => {
    expect(rosterScopeKey("t1", "office")).toBe("t1:office")
    expect(mineScopeKey("t1", "office")).toBe("t1:office:mine")
    expect(exchangeScopeKey(mineScopeKey("t1", "office"))).toBe(rosterScopeKey("t1", "office"))
    expect(exchangeScopeKey("t1:office")).toBe("t1:office")
  })
})

describe("mergeById", () => {
  it("keeps the stored rows (an approved claim stays approved) and adds the missing ones", () => {
    const stored = [claim("c1", "approved")]
    const out = mergeById(stored, [claim("c1", "open"), claim("c2")])
    expect(out.map((c) => [c.id, c.status])).toEqual([["c1", "approved"], ["c2", "open"]])
  })
  it("returns the same array when nothing is missing", () => {
    const stored = [claim("c1")]
    expect(mergeById(stored, [claim("c1", "approved")])).toBe(stored)
  })
})

describe("locations in this session", () => {
  it("a renamed location shows the new name and a new one is added", () => {
    const merged = mergeLocations([loc("A", "Old"), loc("B")], [loc("A", "Renamed"), loc("B"), loc("N", "Test site")])
    expect(merged.map((l) => l.name)).toEqual(["Renamed", "B", "Test site"])
    expect(mergeLocations([loc("A")], undefined).map((l) => l.id)).toEqual(["A"])
  })
  it("an office role may open a location added in this session; a supervisor may not", () => {
    const merged = [loc("A"), loc("N")]
    expect(withNewLocations(office, [loc("A")], merged).locationIds).toEqual(["A", "N"])
    const sup: RosterAccess = { scope: "locations", locationIds: ["A"], editDraft: true, editPublished: false, approve: false }
    expect(withNewLocations(sup, [loc("A")], merged)).toBe(sup)
    expect(withNewLocations(office, [loc("A")], [loc("A")])).toBe(office)
  })
})
