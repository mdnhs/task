import { describe, expect, it } from "vitest"
import type { RosterShift, RosterWeek, ShiftTemplate } from "@/lib/rosters"
import type { WorkforceMember } from "@/lib/workforce"
import { getMyExchange } from "./api"
import { claimShift, requestSwap } from "./exchange"

// What is left of the mock exchange rules is what My roster still uses (claim and swap requests; Task 22 moves it to the API). Approval, the manager's exchange payload and the rule check of
// hypothetical assignments run on the API now (B8 Task 21): their mock tests are gone with the code, the API's own suite covers them (api/src/modules/rosters/exchange*.test.ts).
const week = (status: RosterWeek["status"], locationId = "A"): RosterWeek => ({ id: "w1", locationId, weekStart: "2026-10-19", status, publishedAt: null, publishedBy: null, autoRepeatDays: null })


const tpl: ShiftTemplate = { id: "t", locationId: "A", name: "Door", start: "18:00", end: "02:00", unpaidBreakMin: 0, role: "Security", requires: ["PSA"] }
const mem = (id: string, quals: WorkforceMember["qualifications"] = [{ type: "PSA", expires: "2027-01-01" }], leftOn: string | null = null): WorkforceMember => ({ id, name: id.toUpperCase(), role: "r", dept: "d", homeLocationId: "A", qualifications: quals, leftOn })
const sh = (id: string, personId: string | null, date: string, start = "18:00", end = "02:00", locationId = "A"): RosterShift => ({ id, weekId: "w1", locationId, date, personId, templateId: "t", role: "Security", start, end, unpaidBreakMin: 0, confirmedAt: null })
const AT = "2026-10-20T10:00:00"


describe("claimShift", () => {
  const open = sh("o1", null, "2026-10-24")
  it("returns an open claim for a qualified member", () => {
    expect(claimShift(open, mem("a"), tpl, AT)).toMatchObject({ shiftId: "o1", personId: "a", status: "open", at: AT, decidedBy: null, decidedAt: null })
  })
  it("refuses a missing or expired licence, and someone who has left", () => {
    expect(() => claimShift(open, mem("a", []), tpl, AT)).toThrow(/PSA/)
    expect(() => claimShift(open, mem("a", [{ type: "PSA", expires: "2026-10-01" }]), tpl, AT)).toThrow(/PSA/)
    expect(() => claimShift(open, mem("a", undefined, "2026-10-22"), tpl, AT)).toThrow(/left/i)
  })
  it("refuses a shift that is not open", () => {
    expect(() => claimShift(sh("o2", "b", "2026-10-24"), mem("a"), tpl, AT)).toThrow(/open/i)
  })
})

describe("swaps", () => {
  const a1 = sh("a1", "a", "2026-10-24")
  const b1 = sh("b1", "b", "2026-10-26")
  it("requestSwap needs the requester's own shift and an eligible target", () => {
    expect(requestSwap(a1, "a", mem("b"), tpl, null, AT, "sw1")).toMatchObject({ shiftId: "a1", toShiftId: null, fromPersonId: "a", toPersonId: "b", status: "open" })
    expect(() => requestSwap(a1, "b", mem("b"), tpl, null, AT, "x")).toThrow(/your/i)
    expect(() => requestSwap(a1, "a", mem("a"), tpl, null, AT, "x")).toThrow()
    expect(() => requestSwap(a1, "a", mem("b", []), tpl, null, AT, "x")).toThrow(/PSA/)
    expect(() => requestSwap(a1, "a", mem("b", undefined, "2026-10-22"), tpl, null, AT, "x")).toThrow(/left/i)
    expect(requestSwap(a1, "a", mem("b"), tpl, b1, AT, "sw2").toShiftId).toBe("b1")
  })
})

describe("payloads cut to the caller", () => {
  it("a staff payload has open shifts only at their locations, eligible co-workers by id and name, and no licences", async () => {
    const grace = await getMyExchange("p-grace", "2026-10-20T09:00:00")
    expect(grace.open.map((s) => s.id)).toEqual(["rs-051"]) // Liffey, no licence needed; the Coppers open shifts are not offered (other site, PSA)
    const bell = await getMyExchange("s-bell", "2026-10-20T09:00:00")
    expect(bell.open.map((s) => s.id)).toEqual(expect.arrayContaining(["rs-051", "rs-016"])) // home Liffey, rostered at Coppers
    const haddad = await getMyExchange("s-haddad", "2026-10-20T09:00:00")
    expect(haddad.open.map((s) => s.id)).toContain("rs-016") // Coppers close, PSA licence valid
    expect(haddad.open.every((s) => s.locationId === "loc-coppers")).toBe(true)
    const json = JSON.stringify({ open: haddad.open, peers: haddad.peers, templates: haddad.templates })
    expect(json).not.toMatch(/qualifications|expires/)
    for (const list of Object.values(haddad.peers)) for (const p of list) expect(Object.keys(p).sort()).toEqual(["id", "name"])
    expect(haddad.member?.id).toBe("s-haddad")
    expect(haddad.claims.every((c) => c.personId === "s-haddad")).toBe(true)
  })
  it("co-workers are cut by location and eligibility", async () => {
    const haddad = await getMyExchange("s-haddad", "2026-10-20T09:00:00")
    const ids = new Set(Object.values(haddad.peers).flat().map((p) => p.id))
    expect(ids.has("s-haddad")).toBe(false)
    expect(ids.has("p-grace")).toBe(false) // Liffey only
    expect(ids.has("s-grant")).toBe(false)
  })
})

describe("fix round 1", () => {
  const open = sh("o1", null, "2026-10-24")
  const pub = week("published")
  it("claims and swaps refuse past shifts and unpublished weeks", () => {
    expect(() => claimShift(open, mem("a"), tpl, "2026-10-26T10:00:00", { tz: "Europe/Dublin" })).toThrow(/passed/)
    expect(() => claimShift(open, mem("a"), tpl, AT, { week: week("draft") })).toThrow(/published/)
    expect(claimShift(open, mem("a"), tpl, AT, { week: pub, tz: "Europe/Dublin" }).status).toBe("open")
    const a1 = sh("a1", "a", "2026-10-24")
    expect(() => requestSwap(a1, "a", mem("b"), tpl, null, "2026-10-26T10:00:00", "x", { tz: "Europe/Dublin" })).toThrow(/passed/)
    expect(() => requestSwap(a1, "a", mem("b"), tpl, null, AT, "x", { week: week("draft") })).toThrow(/published/)
  })
  it("claim ids are unique, so a re-claim after a rejection does not overwrite", () => {
    expect(claimShift(open, mem("a"), tpl, AT).id).not.toBe(claimShift(open, mem("a"), tpl, AT).id)
  })
})

