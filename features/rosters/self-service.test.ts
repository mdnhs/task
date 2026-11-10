import { describe, expect, it } from "vitest"
import type { RosterAccess } from "@/lib/roster-access"
import type { LeaveRequest } from "@/lib/roster-rules"
import type { RosterShift, RosterWeek } from "@/lib/rosters"
import type { WorkforceMember } from "@/lib/workforce"
import { getMyRoster, getLeaveQueue, getRosterRules } from "./api"
import { canApproveLeave, combinedRoster, decideLeave, isSeen, isUpcoming, leaveQueue, mergeMine, shiftSig, splitAvailability, validateAvailability, validateLeave } from "./self-service"

const wk = (id: string, locationId: string, status: RosterWeek["status"]): RosterWeek => ({ id, locationId, weekStart: "2026-10-19", status, publishedAt: null, publishedBy: null, autoRepeatDays: null })
const sh = (id: string, weekId: string, locationId: string, personId: string | null, date: string, start = "09:00"): RosterShift => ({ id, weekId, locationId, date, personId, templateId: "t", role: "r", start, end: "17:00", unpaidBreakMin: 0, confirmedAt: null })
const member = (id: string, home: string | null): WorkforceMember => ({ id, name: id, role: "r", dept: "d", homeLocationId: home, qualifications: [], leftOn: null })
const acc = (p: Partial<RosterAccess>): RosterAccess => ({ scope: "locations", locationIds: [], editDraft: false, editPublished: false, approve: false, ...p })
const sup = acc({ editDraft: true, locationIds: ["A"] })
const office = acc({ scope: "all", locationIds: ["A", "B"], editDraft: true, editPublished: true, approve: true })
const lv = (id: string, personId: string, status: LeaveRequest["status"] = "requested"): LeaveRequest => ({ id, personId, from: "2026-11-02", to: "2026-11-03", kind: "Annual leave", status, decidedBy: null, decidedAt: null })

describe("combinedRoster", () => {
  const weeks = [wk("w1", "A", "published"), wk("w2", "B", "published"), wk("w3", "A", "draft")]
  const shifts = [sh("s1", "w1", "A", "me", "2026-10-21"), sh("s2", "w2", "B", "me", "2026-10-20"), sh("s3", "w3", "A", "me", "2026-10-22"), sh("s4", "w1", "A", "other", "2026-10-21"), sh("s5", "w1", "A", null, "2026-10-21")]
  it("joins two locations in date order and hides drafts and other people", () => {
    expect(combinedRoster("me", shifts, weeks).map((s) => s.id)).toEqual(["s2", "s1"])
  })
})

describe("canApproveLeave", () => {
  it("supervisor of the home location only, office always, own scope never", () => {
    expect(canApproveLeave(sup, member("x", "A"))).toBe(true)
    expect(canApproveLeave(sup, member("x", "B"))).toBe(false)
    expect(canApproveLeave(sup, member("x", null))).toBe(false)
    expect(canApproveLeave(office, member("x", "B"))).toBe(true)
    expect(canApproveLeave(office, member("x", null))).toBe(true)
    expect(canApproveLeave(acc({ scope: "own", locationIds: null }), member("x", "A"))).toBe(false)
    expect(canApproveLeave(acc({ scope: "all", locationIds: ["A"] }), member("x", "A"))).toBe(false) // read-only auditor
    const except = acc({ scope: "all", locationIds: ["A"], editDraft: true, editPublished: true, approve: true }) // office role whose except hides B
    expect(canApproveLeave(except, member("x", "A"))).toBe(true)
    expect(canApproveLeave(except, member("x", "B"))).toBe(false)
    expect(canApproveLeave(except, member("x", null))).toBe(true)
  })
})

describe("decideLeave", () => {
  it("sets status, decidedBy and decidedAt", () => {
    expect(decideLeave(lv("l", "x"), true, "boss", "2026-10-21T10:00:00")).toMatchObject({ status: "approved", decidedBy: "boss", decidedAt: "2026-10-21T10:00:00" })
    expect(decideLeave(lv("l", "x"), false, "boss", "t").status).toBe("rejected")
  })
  it("refuses a request that is not 'requested' and never mutates", () => {
    const done = lv("l", "x", "approved")
    expect(() => decideLeave(done, false, "b", "t")).toThrow()
    const r = lv("l2", "x")
    decideLeave(r, true, "b", "t")
    expect(r.status).toBe("requested")
  })
})

describe("own leave", () => {
  it("decideLeave refuses a decision by the requester", () => {
    expect(() => decideLeave(lv("l", "x"), true, "x", "t")).toThrow()
  })
  it("getLeaveQueue leaves out the caller's own requests", async () => {
    const all = acc({ scope: "all", locationIds: ["loc-coppers", "loc-docklands", "loc-liffey"], editDraft: true, editPublished: true, approve: true })
    const q = await getLeaveQueue(all, "s-haddad")
    expect(q.leave.every((l) => l.personId !== "s-haddad")).toBe(true)
    expect(q.names["s-haddad"]).toBeUndefined()
  })
})

describe("seen follows the current shift", () => {
  const s = sh("s1", "w1", "A", "me", "2026-10-21")
  it("is seen while the signature matches, not after a move", () => {
    const conf = { s1: { at: "t", sig: shiftSig(s) } }
    expect(isSeen(s, conf)).toBe(true)
    expect(isSeen({ ...s, start: "10:00" }, conf)).toBe(false)
    expect(isSeen({ ...s, date: "2026-10-22" }, conf)).toBe(false)
    expect(isSeen({ ...s, locationId: "B" }, conf)).toBe(false)
  })
  it("a server confirmation counts until an edit clears it", () => {
    expect(isSeen({ ...s, confirmedAt: "2026-10-15T10:00:00" }, {})).toBe(true)
    expect(isSeen(s, {})).toBe(false)
  })
})

describe("mergeMine (office edits show in the same session)", () => {
  const weeks = [wk("w1", "A", "published"), wk("w2", "B", "published")]
  const base = [sh("s1", "w1", "A", "me", "2026-10-21"), sh("s2", "w2", "B", "me", "2026-10-22"), sh("s3", "w1", "A", "me", "2026-10-23")]
  it("without live data it is the server list", () => {
    expect(mergeMine("me", base, weeks, undefined).map((x) => x.id)).toEqual(["s1", "s2", "s3"])
  })
  it("shows moves and deletions from live weeks, keeps weeks the live store does not cover, and hides unpublished", () => {
    const live = { weeks: [wk("w1", "A", "published")], shifts: [{ ...base[0], date: "2026-10-24" }] } // s3 deleted, s1 moved
    expect(mergeMine("me", base, weeks, live).map((x) => [x.id, x.date])).toEqual([["s2", "2026-10-22"], ["s1", "2026-10-24"]])
    const unpub = { weeks: [wk("w1", "A", "draft")], shifts: base.filter((x) => x.weekId === "w1") }
    expect(mergeMine("me", base, weeks, unpub).map((x) => x.id)).toEqual(["s2"])
  })
  it("never includes someone else's live shifts", () => {
    const live = { weeks: weeks, shifts: [...base, sh("o", "w1", "A", "other", "2026-10-21")] }
    expect(mergeMine("me", base, weeks, live).every((x) => x.personId === "me")).toBe(true)
  })
})

describe("isUpcoming uses the end instant", () => {
  const s = { ...sh("s", "w", "A", "me", "2026-10-21"), start: "09:00", end: "17:00" }
  it("a shift that ended earlier today is not upcoming", () => {
    expect(isUpcoming(s, "2026-10-21T18:00:00", "Europe/London")).toBe(false)
    expect(isUpcoming(s, "2026-10-21T12:00:00", "Europe/London")).toBe(true)
  })
  it("an overnight shift is upcoming until its next-day end", () => {
    const n = { ...s, start: "22:00", end: "06:00" }
    expect(isUpcoming(n, "2026-10-22T03:00:00", "Europe/London")).toBe(true)
    expect(isUpcoming(n, "2026-10-22T07:00:00", "Europe/London")).toBe(false)
  })
})

describe("availability windows", () => {
  it("allows an overnight window and splits it at midnight onto two weekdays", () => {
    expect(validateAvailability({ weekday: 5, from: "22:00", to: "06:00" })).toBeNull()
    expect(splitAvailability("me", { weekday: 5, from: "22:00", to: "06:00" })).toEqual([
      { personId: "me", weekday: 5, from: "22:00", to: "23:59" },
      { personId: "me", weekday: 6, from: "00:00", to: "06:00" },
    ])
    expect(splitAvailability("me", { weekday: 6, from: "22:00", to: "06:00" })[1].weekday).toBe(0)
    expect(splitAvailability("me", { weekday: 1, from: "09:00", to: "17:00" })).toHaveLength(1)
  })
  it("rejects an empty window and a duplicate", () => {
    expect(validateAvailability({ weekday: 1, from: "09:00", to: "09:00" })).toBeTruthy()
    const have = [{ personId: "me", weekday: 1 as const, from: "09:00", to: "17:00" }]
    expect(validateAvailability({ weekday: 1, from: "09:00", to: "17:00" }, "me", have)).toMatch(/already/i)
    expect(validateAvailability({ weekday: 1, from: "09:00", to: "18:00" }, "me", have)).toBeNull()
  })
})

describe("leaveQueue", () => {
  it("lists waiting requests of approvable people only", () => {
    const members = [member("a", "A"), member("b", "B")]
    const leave = [lv("1", "a"), lv("2", "b"), lv("3", "a", "approved")]
    expect(leaveQueue(leave, members, sup).map((l) => l.id)).toEqual(["1"])
    expect(leaveQueue(leave, members, office).map((l) => l.id)).toEqual(["1", "2"])
  })
})

describe("validation", () => {
  it("leave needs dates in order and a type", () => {
    expect(validateLeave({ from: "2026-11-03", to: "2026-11-02", kind: "x" }).to).toBeTruthy()
    expect(validateLeave({ from: "", to: "", kind: "" })).toMatchObject({ from: expect.any(String), to: expect.any(String), kind: expect.any(String) })
    expect(validateLeave({ from: "2026-11-02", to: "2026-11-02", kind: "Annual leave" })).toEqual({})
  })
  it("availability needs a start and end", () => {
    expect(validateAvailability({ weekday: 1, from: "", to: "09:00" })).toBeTruthy()
    expect(validateAvailability({ weekday: 1, from: "09:00", to: "17:00" })).toBeNull()
  })
  it("leave may start in the past (sick leave)", () => {
    expect(validateLeave({ from: "2020-01-01", to: "2020-01-02", kind: "Sick leave" })).toEqual({})
  })
})

describe("server payloads", () => {
  it("a staff-home caller gets only own shifts, own leave and availability, and no queue", async () => {
    const mine = await getMyRoster("p-daniel")
    expect(mine.shifts.length).toBeGreaterThan(0)
    expect(mine.shifts.every((s) => s.personId === "p-daniel")).toBe(true)
    expect(mine.leave.every((l) => l.personId === "p-daniel")).toBe(true)
    expect(mine.availability.every((a) => a.personId === "p-daniel")).toBe(true)
    const q = await getLeaveQueue(acc({ scope: "own", locationIds: null }), "p-daniel")
    expect(q).toEqual({ leave: [], names: {} })
    const json = JSON.stringify(mine)
    expect(json).not.toContain("s-haddad")
    expect(json).not.toContain("s-bell")
  })
  it("never sends drafts", async () => {
    const mine = await getMyRoster("p-daniel")
    const weeks = new Map(mine.weeks.map((w) => [w.id, w]))
    expect(mine.shifts.every((s) => weeks.get(s.weekId)?.status === "published")).toBe(true)
  })
  it("the supervisor's rules payload carries only what the check needs from leave", async () => {
    const r = await getRosterRules(acc({ editDraft: true, locationIds: ["loc-coppers"] }))
    expect(r.leave.every((l) => l.status === "approved" && l.kind === "" && l.decidedBy === null && l.decidedAt === null)).toBe(true)
  })
  it("a supervisor's queue holds only people homed at their locations", async () => {
    const q = await getLeaveQueue(acc({ editDraft: true, locationIds: ["loc-coppers"] }), "p-ismail")
    expect(q.leave.every((l) => ["p-marcus", "p-leo", "s-haddad", "p-ismail"].includes(l.personId))).toBe(true)
    expect(JSON.stringify(q)).not.toContain("s-bell") // Liffey, lv-002 is waiting
    const all = await getLeaveQueue(acc({ scope: "all", locationIds: ["loc-coppers", "loc-docklands", "loc-liffey"], editDraft: true, editPublished: true, approve: true }), "p-ismail")
    expect(all.leave.map((l) => l.id)).toContain("lv-002")
    expect(all.names["s-bell"]).toBeTruthy()
  })
})
