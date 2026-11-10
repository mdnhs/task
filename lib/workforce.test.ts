import { describe, expect, it } from "vitest"
import { mergeWorkforce } from "./workforce"
import type { Person } from "./types"

const people: Person[] = [
  { id: "p-daniel", name: "Daniel Okafor", role: "Security Supervisor", initials: "DO", avatar: "av1", dept: "Security" },
  { id: "p-grace", name: "Grace Mensah", role: "Cleaning Team Lead", initials: "GM", avatar: "av2", dept: "Cleaning" },
]
const staff = [
  { id: "s-daniel", personId: "p-daniel", name: "Daniel Okafor", role: "Security Supervisor", dept: "Security" },
  { id: "s-bell", name: "Marcus Bell", role: "Security Officer", dept: "Security" },
]
const extras = [{ id: "p-daniel", homeLocationId: "loc-a", qualifications: [{ type: "SIA", expires: "2027-01-01" }] }]

describe("mergeWorkforce", () => {
  const w = mergeWorkforce(people, staff, extras)
  it("merges a staff row with personId into the directory person", () => {
    const d = w.filter((m) => m.name === "Daniel Okafor")
    expect(d).toHaveLength(1)
    expect(d[0].id).toBe("p-daniel")
    expect(d[0].homeLocationId).toBe("loc-a")
    expect(d[0].qualifications).toEqual([{ type: "SIA", expires: "2027-01-01" }])
  })
  it("keeps the s-* id for a row without personId", () => {
    const b = w.find((m) => m.id === "s-bell")
    expect(b?.name).toBe("Marcus Bell")
    expect(b?.homeLocationId).toBeNull()
    expect(b?.leftOn).toBeNull()
  })
  it("has no duplicate ids", () => {
    const ids = w.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(["p-daniel", "p-grace", "s-bell"]))
  })
})
