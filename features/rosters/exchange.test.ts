import { describe, expect, it } from "vitest"
import type { RosterAccess } from "@/lib/roster-access"
import type { RuleContext } from "@/lib/roster-rules"
import type { Location, RosterShift, RosterWeek, ShiftTemplate } from "@/lib/rosters"
import type { WorkforceMember } from "@/lib/workforce"
import { assignmentCheck, getMyExchange, getRosterExchange, type AssignData } from "./api"
import { approveClaim, approveSwap, approverFor, claimShift, requestSwap, type Claim } from "./exchange"
import type { SwapRequest } from "./types"

const loc = (id: string, swapApprovalDelegated = false): Location => ({ id, name: id, address: "", pin: { lat: 0, lng: 0 }, zoneRadiusM: 100, openingHours: "", contact: "", swapApprovalDelegated })
const week = (status: RosterWeek["status"], locationId = "A"): RosterWeek => ({ id: "w1", locationId, weekStart: "2026-10-19", status, publishedAt: null, publishedBy: null, autoRepeatDays: null })
const acc = (p: Partial<RosterAccess>): RosterAccess => ({ scope: "locations", locationIds: ["A"], editDraft: false, editPublished: false, approve: false, ...p })
const sup = acc({ editDraft: true })
const office = acc({ scope: "all", locationIds: ["A", "B"], editDraft: true, editPublished: true, approve: true })
const staff = acc({ scope: "own", locationIds: null })

const tpl: ShiftTemplate = { id: "t", locationId: "A", name: "Door", start: "18:00", end: "02:00", unpaidBreakMin: 0, role: "Security", requires: ["PSA"] }
const mem = (id: string, quals: WorkforceMember["qualifications"] = [{ type: "PSA", expires: "2027-01-01" }], leftOn: string | null = null): WorkforceMember => ({ id, name: id.toUpperCase(), role: "r", dept: "d", homeLocationId: "A", qualifications: quals, leftOn })
const sh = (id: string, personId: string | null, date: string, start = "18:00", end = "02:00", locationId = "A"): RosterShift => ({ id, weekId: "w1", locationId, date, personId, templateId: "t", role: "Security", start, end, unpaidBreakMin: 0, confirmedAt: null })
const ctxOf = (shifts: RosterShift[], members: WorkforceMember[], severity: Partial<RuleContext["severity"]> = {}): RuleContext => ({
  shifts, members, leave: [], availability: [], templates: [tpl], avgWeekReferenceWeeks: 17, tz: "Europe/Dublin", visibleLocationIds: null,
  severity: { double_booking: "block", approved_leave: "block", unavailable: "warn", daily_rest: "block", weekly_rest: "warn", avg_48h: "warn", expired_licence: "warn", left: "warn", ...severity },
})
const AT = "2026-10-20T10:00:00"

describe("approverFor (D6)", () => {
  it("supervisor approves on a draft week, not on a published one", () => {
    expect(approverFor(week("draft"), loc("A"), sup)).toBe(true)
    expect(approverFor(week("published"), loc("A"), sup)).toBe(false)
  })
  it("a supervisor approves a published week only when the location delegates", () => {
    expect(approverFor(week("published"), loc("A", true), sup)).toBe(true)
  })
  it("office always approves", () => {
    expect(approverFor(week("published"), loc("A"), office)).toBe(true)
    expect(approverFor(week("draft"), loc("A"), office)).toBe(true)
  })
  it("never outside the caller's locations, never for staff", () => {
    expect(approverFor(week("draft", "B"), loc("B", true), sup)).toBe(false)
    expect(approverFor(week("draft"), loc("A"), staff)).toBe(false)
    expect(approverFor(week("published", "C"), loc("C"), office)).toBe(false)
  })
})

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

describe("approveClaim", () => {
  const open = sh("o1", null, "2026-10-24")
  const claim: Claim = { id: "c1", shiftId: "o1", personId: "a", at: AT, status: "open", decidedBy: null, decidedAt: null }
  const members = [mem("a"), mem("b")]
  it("assigns the claimant, clears confirmation, logs history with the week", () => {
    const r = approveClaim(claim, open, office, week("published"), loc("A"), ctxOf([open], members), "boss", AT)
    expect(r.shift).toMatchObject({ id: "o1", personId: "a", confirmedAt: null })
    expect(r.claim).toMatchObject({ status: "approved", decidedBy: "boss", decidedAt: AT })
    expect(r.entry).toMatchObject({ weekId: "w1", shiftId: "o1", action: "claim.approved", by: "boss" })
    expect(r.violations).toEqual([])
  })
  it("refuses a double booking (blocking), the caller cannot override without office and a reason", () => {
    const mine = sh("m1", "a", "2026-10-24", "20:00", "04:00")
    const ctx = ctxOf([open, mine], members)
    expect(() => approveClaim(claim, open, office, week("published"), loc("A"), ctx, "boss", AT)).toThrow(/double|already/i)
    expect(() => approveClaim(claim, open, office, week("published"), loc("A"), ctx, "boss", AT, "  ")).toThrow()
    expect(() => approveClaim(claim, open, sup, week("draft"), loc("A"), ctx, "boss", AT, "cover needed")).toThrow()
    const r = approveClaim(claim, open, office, week("published"), loc("A"), ctx, "boss", AT, "Short staffed tonight")
    expect(r.shift.personId).toBe("a")
    expect(r.entry.reason).toBe("Short staffed tonight")
  })
  it("returns warnings with the approved shift", () => {
    const next = sh("m2", "a", "2026-10-25", "09:00", "17:00") // 7h after the open shift ends at 02:00 on the 25th: daily rest
    const r = approveClaim(claim, open, office, week("published"), loc("A"), ctxOf([open, next], members, { daily_rest: "warn" }), "boss", AT)
    expect(r.violations.some((v) => v.rule === "daily_rest")).toBe(true)
    expect(r.shift.personId).toBe("a")
  })
  it("is guarded by approverFor and location access", () => {
    const ctx = ctxOf([open], members)
    expect(() => approveClaim(claim, open, sup, week("published"), loc("A"), ctx, "s", AT)).toThrow(/approve/i)
    expect(() => approveClaim(claim, open, acc({ editDraft: true, locationIds: ["B"] }), week("draft"), loc("A"), ctx, "s", AT)).toThrow()
    expect(() => approveClaim(claim, open, staff, week("draft"), loc("A"), ctx, "s", AT)).toThrow()
    expect(approveClaim(claim, open, sup, week("published"), loc("A", true), ctx, "s", AT).shift.personId).toBe("a")
  })
  it("refuses a claim already decided, or on a shift that is no longer open", () => {
    const ctx = ctxOf([open], members)
    expect(() => approveClaim({ ...claim, status: "rejected" }, open, office, week("published"), loc("A"), ctx, "b", AT)).toThrow()
    expect(() => approveClaim(claim, { ...open, personId: "b" }, office, week("published"), loc("A"), ctx, "b", AT)).toThrow(/open/i)
  })
  it("folds in violations found elsewhere (server check)", () => {
    const elsewhere = [{ rule: "double_booking" as const, shiftId: "o1", personId: "a", severity: "block" as const, message: "Already rostered elsewhere", otherShiftIds: [] }]
    expect(() => approveClaim(claim, open, office, week("published"), loc("A"), ctxOf([open], members), "boss", AT, null, elsewhere)).toThrow(/elsewhere/)
  })
})

describe("swaps", () => {
  const a1 = sh("a1", "a", "2026-10-24")
  const b1 = sh("b1", "b", "2026-10-26")
  const members = [mem("a"), mem("b")]
  const swap = (p: Partial<SwapRequest> = {}): SwapRequest => ({ id: "sw1", shiftId: "a1", toShiftId: null, fromPersonId: "a", toPersonId: "b", at: AT, status: "open", decidedBy: null, decidedAt: null, ...p })
  it("requestSwap needs the requester's own shift and an eligible target", () => {
    expect(requestSwap(a1, "a", mem("b"), tpl, null, AT, "sw1")).toMatchObject({ shiftId: "a1", toShiftId: null, fromPersonId: "a", toPersonId: "b", status: "open" })
    expect(() => requestSwap(a1, "b", mem("b"), tpl, null, AT, "x")).toThrow(/your/i)
    expect(() => requestSwap(a1, "a", mem("a"), tpl, null, AT, "x")).toThrow()
    expect(() => requestSwap(a1, "a", mem("b", []), tpl, null, AT, "x")).toThrow(/PSA/)
    expect(() => requestSwap(a1, "a", mem("b", undefined, "2026-10-22"), tpl, null, AT, "x")).toThrow(/left/i)
    expect(requestSwap(a1, "a", mem("b"), tpl, b1, AT, "sw2").toShiftId).toBe("b1")
  })
  it("a hand-over moves the shift to the other person", () => {
    const r = approveSwap(swap(), a1, null, office, week("published"), loc("A"), ctxOf([a1, b1], members), "boss", AT)
    expect(r.shift.personId).toBe("b")
    expect(r.other).toBeNull()
    expect(r.request.status).toBe("approved")
    expect(r.entry).toMatchObject({ weekId: "w1", action: "swap.approved" })
  })
  it("a trade swaps both people", () => {
    const r = approveSwap(swap({ toShiftId: "b1" }), a1, b1, office, week("published"), loc("A"), ctxOf([a1, b1], members), "boss", AT)
    expect([r.shift.personId, r.other?.personId]).toEqual(["b", "a"])
  })
  it("is refused when either side breaks a blocking rule", () => {
    const bBusy = sh("b2", "b", "2026-10-24", "20:00", "04:00") // overlaps a1 once b takes it
    expect(() => approveSwap(swap(), a1, null, office, week("published"), loc("A"), ctxOf([a1, bBusy], members), "boss", AT)).toThrow(/double|already/i)
    const aBusy = sh("a2", "a", "2026-10-26", "20:00", "04:00") // overlaps b1 once a takes it (trade)
    expect(() => approveSwap(swap({ toShiftId: "b1" }), a1, b1, office, week("published"), loc("A"), ctxOf([a1, b1, aBusy], members), "boss", AT)).toThrow(/double|already/i)
  })
  it("is guarded like claims, and refuses a stale swap", () => {
    expect(() => approveSwap(swap(), a1, null, sup, week("published"), loc("A"), ctxOf([a1], members), "s", AT)).toThrow(/approve/i)
    expect(approveSwap(swap(), a1, null, sup, week("published"), loc("A", true), ctxOf([a1], members), "s", AT).shift.personId).toBe("b")
    expect(() => approveSwap(swap(), { ...a1, personId: "c" }, null, office, week("published"), loc("A"), ctxOf([a1], members), "s", AT)).toThrow()
    expect(() => approveSwap(swap({ status: "approved" }), a1, null, office, week("published"), loc("A"), ctxOf([a1], members), "s", AT)).toThrow()
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
  it("the manager exchange is cut to permitted locations", async () => {
    const none = await getRosterExchange(acc({ locationIds: ["loc-docklands"] }))
    expect(none.claims).toEqual([])
    const liffey = await getRosterExchange(acc({ locationIds: ["loc-liffey"] }))
    expect(liffey.claims.map((c) => c.shiftId)).toEqual(["rs-051"])
    expect(Object.values(liffey.names)).toEqual(["Bell"].map((n) => expect.stringContaining(n)))
    expect(await getRosterExchange(acc({ scope: "own", locationIds: null }))).toEqual({ claims: [], swaps: [], names: {}, members: [] })
  })
})

describe("fix round 1", () => {
  const open = sh("o1", null, "2026-10-24")
  const claim: Claim = { id: "c1", shiftId: "o1", personId: "a", at: AT, status: "open", decidedBy: null, decidedAt: null }
  const pub = week("published")
  it("approval throws when the member or template is missing from ctx (a supervisor's cut list)", () => {
    expect(() => approveClaim(claim, open, office, pub, loc("A"), ctxOf([open], []), "b", AT)).toThrow(/verify/i)
    expect(() => approveClaim(claim, open, office, pub, loc("A"), { ...ctxOf([open], [mem("a")]), templates: [] }, "b", AT)).toThrow(/verify/i)
    const a1 = sh("a1", "a", "2026-10-24")
    const r = { id: "sw", shiftId: "a1", toShiftId: null, fromPersonId: "a", toPersonId: "b", at: AT, status: "open" as const, decidedBy: null, decidedAt: null }
    expect(() => approveSwap(r, a1, null, office, pub, loc("A"), ctxOf([a1], [mem("a")]), "x", AT)).toThrow(/verify/i)
  })
  it("claims and swaps refuse past shifts and unpublished weeks", () => {
    expect(() => claimShift(open, mem("a"), tpl, "2026-10-26T10:00:00", { tz: "Europe/Dublin" })).toThrow(/passed/)
    expect(() => claimShift(open, mem("a"), tpl, AT, { week: week("draft") })).toThrow(/published/)
    expect(claimShift(open, mem("a"), tpl, AT, { week: pub, tz: "Europe/Dublin" }).status).toBe("open")
    const a1 = sh("a1", "a", "2026-10-24")
    expect(() => requestSwap(a1, "a", mem("b"), tpl, null, "2026-10-26T10:00:00", "x", { tz: "Europe/Dublin" })).toThrow(/passed/)
    expect(() => requestSwap(a1, "a", mem("b"), tpl, null, AT, "x", { week: week("draft") })).toThrow(/published/)
  })
  it("a supervisor's exchange members cover the people on claims, with home dropped and licences cut", async () => {
    const x = await getRosterExchange(acc({ locationIds: ["loc-liffey"] }))
    expect(x.members.map((m) => m.id)).toEqual(["s-bell"])
    expect(x.members[0].homeLocationId).toBeNull()
  })
  it("claim ids are unique, so a re-claim after a rejection does not overwrite", () => {
    expect(claimShift(open, mem("a"), tpl, AT).id).not.toBe(claimShift(open, mem("a"), tpl, AT).id)
  })
})

describe("assignmentCheck (server rule check)", () => {
  const rules = { avgWeekReferenceWeeks: 17, severity: ctxOf([], []).severity }
  const base = (over: Partial<AssignData> = {}): AssignData => ({
    rules, leave: [], availability: [], templates: [tpl, { ...tpl, id: "tB", locationId: "B", requires: [] }],
    shifts: [sh("o1", null, "2026-10-24")], members: [mem("a"), mem("z", [])], allLocationIds: ["A", "B"], ...over,
  })
  const pair = [{ shiftId: "o1", personId: "a" }]
  it("an arbitrary pair for a visible shift with an unrelated person returns nothing", () => {
    const leave = [{ id: "l", personId: "z", from: "2026-10-24", to: "2026-10-30", kind: "Sick", status: "approved" as const, decidedBy: null, decidedAt: null }]
    const away = { ...mem("z"), homeLocationId: "B" }
    expect(assignmentCheck(sup, [{ shiftId: "o1", personId: "z" }], base({ leave, members: [away] }), "Europe/Dublin")).toEqual([])
    expect(assignmentCheck(sup, [{ shiftId: "o1", personId: "nobody" }], base(), "Europe/Dublin")).toEqual([])
  })
  it("a shift outside the caller's locations returns nothing", () => {
    expect(assignmentCheck(sup, pair, base({ shifts: [sh("o1", null, "2026-10-24", "18:00", "02:00", "B")] }), "Europe/Dublin")).toEqual([])
    expect(assignmentCheck(staff, pair, base(), "Europe/Dublin")).toEqual([])
  })
  it("a clash at a site the caller can't see returns only the generic message", () => {
    const hidden = { ...sh("h1", "a", "2026-10-24", "20:00", "04:00", "B"), templateId: "tB" }
    const v = assignmentCheck(sup, pair, base({ shifts: [sh("o1", null, "2026-10-24"), hidden] }), "Europe/Dublin")
    expect(v.some((x) => x.rule === "double_booking" && x.message === "Already rostered elsewhere" && x.severity === "block")).toBe(true)
    expect(JSON.stringify(v)).not.toMatch(/h1|20:00|04:00/)
  })
  it("leave dates, availability windows and hour totals are not spelled out for a location-scoped caller", () => {
    const leave = [{ id: "l", personId: "a", from: "2026-10-24", to: "2026-10-30", kind: "Sick", status: "approved" as const, decidedBy: null, decidedAt: null }]
    const v = assignmentCheck(sup, pair, base({ leave }), "Europe/Dublin")
    expect(v.find((x) => x.rule === "approved_leave")?.message).not.toMatch(/2026-10-30|2026-10-24/)
    const o = assignmentCheck(office, pair, base({ leave }), "Europe/Dublin")
    expect(o.find((x) => x.rule === "approved_leave")?.message).toMatch(/2026-10-30/)
  })
  it("no hour total from hidden-site hours reaches a supervisor or an office role with an except", () => {
    const week = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-26"].map((d, i) => ({ ...sh(`b${i}`, "a", d, "04:00", "22:00", "B"), templateId: "tB" }))
    const hours = base({ rules: { avgWeekReferenceWeeks: 1, severity: rules.severity }, shifts: [sh("o1", null, "2026-10-24"), ...week] })
    const o: RosterAccess = { ...office, locationIds: ["A"] } // office role whose except hides B
    for (const a of [sup, o]) {
      const v = assignmentCheck(a, pair, hours, "Europe/Dublin").filter((x) => x.rule === "avg_48h")
      expect(v.length).toBeGreaterThan(0)
      for (const x of v) expect(x.message).toBe("A would go over the 48-hour weekly average")
    }
    const seesAll = assignmentCheck(office, pair, hours, "Europe/Dublin").filter((x) => x.rule === "avg_48h")
    expect(seesAll.length).toBeGreaterThan(0)
    for (const x of seesAll) expect(x.message).toMatch(/\d+\.\dh/)
  })
  it("left and expired or missing licence are blocking whatever rules.json says", () => {
    const sev = { ...rules, severity: { ...rules.severity, left: "warn" as const, expired_licence: "warn" as const } }
    const gone = mem("a", undefined, "2026-10-20")
    const l = assignmentCheck(sup, pair, base({ rules: sev, members: [gone] }), "Europe/Dublin")
    expect(l.some((x) => x.rule === "left" && x.severity === "block")).toBe(true)
    const expired = mem("a", [{ type: "PSA", expires: "2026-10-01" }])
    expect(assignmentCheck(sup, pair, base({ rules: sev, members: [expired] }), "Europe/Dublin").some((x) => x.rule === "expired_licence" && x.severity === "block")).toBe(true)
    const none = mem("a", [])
    expect(assignmentCheck(sup, pair, base({ rules: sev, members: [none] }), "Europe/Dublin").some((x) => x.severity === "block" && /PSA/.test(x.message))).toBe(true)
  })
})
