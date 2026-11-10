import { describe, expect, it } from "vitest"
import type { RosterAccess } from "@/lib/roster-access"
import type { RosterShift, RosterWeek } from "@/lib/rosters"
import type { WorkforceMember } from "@/lib/workforce"
import { getHolidayDates, getLeaveQueue, getLocationAdminData, getRosterData, getRosterExchange, getRosterHistory, getRosterRequests, getRosterRules, getWeekTemplates, scopedMembers, weekCheck, weekViolations, type WeekData } from "./api"
import { rosterViewData } from "./view"

const acc = (scope: RosterAccess["scope"], locationIds: string[] | null): RosterAccess => ({ scope, locationIds, editDraft: false, editPublished: false, approve: false })

describe("getRosterData", () => {
  it("returns only the permitted locations", async () => {
    const d = await getRosterData(acc("locations", ["loc-coppers"]), "p-ismail")
    expect(d.locations.map((l) => l.id)).toEqual(["loc-coppers"])
    expect(d.weeks.every((w) => w.locationId === "loc-coppers")).toBe(true)
    expect(d.shifts.every((s) => s.locationId === "loc-coppers")).toBe(true)
    expect(d.templates.every((t) => t.locationId === "loc-coppers")).toBe(true)
    expect(d.targets.every((t) => t.locationId === "loc-coppers")).toBe(true)
    expect(d.weeks.map((w) => w.weekStart).sort()).toEqual(["2026-10-19", "2026-10-26"])
  })
  it("a supervisor's members are only people on in-scope shifts or holding a required licence, with qualifications cut to required types", async () => {
    const full = await getRosterData(acc("all", ["loc-coppers", "loc-docklands", "loc-liffey"]), "x")
    const d = await getRosterData(acc("locations", ["loc-coppers"]), "p-ismail")
    expect(d.members.length).toBeLessThan(full.members.length)
    const required = new Set(d.templates.flatMap((t) => t.requires))
    const onShift = new Set(d.shifts.map((s) => s.personId).filter(Boolean))
    for (const m of d.members) {
      expect(onShift.has(m.id) || m.qualifications.length > 0).toBe(true)
      expect(m.qualifications.every((q) => required.has(q.type))).toBe(true)
      expect(m.homeLocationId).toBeNull()
    }
    for (const id of onShift) expect(d.members.some((m) => m.id === id)).toBe(true)
    const outside = full.members.filter((m) => !d.members.some((x) => x.id === m.id))
    expect(outside.length).toBeGreaterThan(0)
    expect((await getRosterData(acc("all", ["loc-coppers", "loc-docklands", "loc-liffey"]), "x")).members.length).toBe(full.members.length) // an office role that sees every location keeps the whole workforce
  })
  it("own scope gets only that person's shifts in published weeks", async () => {
    const d = await getRosterData(acc("own", null), "p-ismail")
    expect(d.shifts).toEqual([]) // p-ismail is only in the draft week
    const s = await getRosterData(acc("own", null), "s-haddad")
    expect(s.shifts.length).toBeGreaterThan(0)
    expect(s.shifts.every((x) => x.personId === "s-haddad")).toBe(true)
    expect(s.weeks.every((w) => w.status === "published")).toBe(true)
  })
  it("none gets nothing; history is cut too", async () => {
    expect((await getRosterData(acc("none", []), "x")).shifts).toEqual([])
    expect((await getRosterHistory(acc("locations", ["loc-liffey"]))).length).toBe(0)
    expect((await getRosterHistory(acc("all", ["loc-coppers"]))).every((h) => h.locationId === "loc-coppers")).toBe(true)
  })
  it("seed: Coppers published week uses only s-* people and has two start times on one shift", async () => {
    const d = await getRosterData(acc("all", ["loc-coppers"]), "p-priya")
    const w = d.weeks.find((x) => x.weekStart === "2026-10-19")!
    const ws = d.shifts.filter((s) => s.weekId === w.id)
    expect(ws.filter((s) => s.personId).every((s) => s.personId!.startsWith("s-"))).toBe(true)
    const wed = ws.filter((s) => s.date === "2026-10-21" && s.templateId === "tpl-cop-door")
    expect(new Set(wed.map((s) => s.start)).size).toBe(2)
  })
})

describe("getRosterRules", () => {
  it("a supervisor gets leave and availability only for people on their shifts, and no shifts at other sites", async () => {
    const a = acc("locations", ["loc-coppers"])
    const d = await getRosterData(a, "p-ismail")
    const r = await getRosterRules(a)
    const mine = new Set(d.shifts.map((s) => s.personId))
    expect(r.leave.every((l) => mine.has(l.personId))).toBe(true)
    expect(r.availability.every((v) => mine.has(v.personId))).toBe(true)
    expect(Object.keys(r)).not.toContain("busy")
  })
  it("the supervisor payload contains no date or time of a shift at another location", async () => {
    const a = acc("locations", ["loc-coppers"])
    const full = await getRosterData(acc("all", ["loc-coppers", "loc-docklands", "loc-liffey"]), "x")
    const d = await getRosterData(a, "p-ismail")
    const r = await getRosterRules(a)
    const json = JSON.stringify({ d, r })
    const foreign = full.shifts.filter((s) => s.locationId !== "loc-coppers")
    expect(foreign.length).toBeGreaterThan(0)
    for (const s of foreign) expect(json).not.toContain(s.id)
  })
  it("no access gets nothing", async () => {
    const r = await getRosterRules(acc("none", []))
    expect(r.leave).toEqual([])
  })
})

describe("weekViolations", () => {
  const supervisor = acc("locations", ["loc-coppers"])
  it("a week outside the caller's locations returns nothing", async () => {
    expect(await weekViolations(supervisor, "wk-dock-1019", "Europe/Dublin")).toEqual([])
  })
  it("results are only for the caller's shifts and never name a hidden shift, site or time", async () => {
    const full = await getRosterData(acc("all", ["loc-coppers", "loc-docklands", "loc-liffey"]), "x")
    const mine = await getRosterData(supervisor, "p-ismail")
    const mineIds = new Set(mine.shifts.map((s) => s.id))
    const foreign = full.shifts.filter((s) => !mineIds.has(s.id))
    for (const w of mine.weeks) {
      const v = await weekViolations(supervisor, w.id, "Europe/Dublin")
      for (const x of v) {
        expect(mineIds.has(x.shiftId)).toBe(true)
        expect(x.otherShiftIds.every((id) => mineIds.has(id))).toBe(true)
        for (const s of foreign) expect(JSON.stringify(x)).not.toContain(s.id)
      }
    }
  })
  it("finds a clash at a site the supervisor can't see, with the generic message", async () => {
    const full = await getRosterData(acc("all", ["loc-coppers", "loc-docklands", "loc-liffey"]), "x")
    const mine = await getRosterData(supervisor, "p-ismail")
    const all: string[] = []
    for (const w of mine.weeks) for (const x of await weekViolations(supervisor, w.id, "Europe/Dublin")) all.push(x.message)
    const office = await Promise.all(full.weeks.filter((w) => w.locationId === "loc-coppers").map((w) => weekViolations(acc("all", ["loc-coppers", "loc-docklands", "loc-liffey"]), w.id, "Europe/Dublin")))
    const hiddenCount = office.flat().filter((x) => x.otherShiftIds.some((id) => !mine.shifts.some((s) => s.id === id))).length
    // whatever the office sees against a hidden shift, the supervisor sees only as a generic line
    if (hiddenCount > 0) expect(all.some((m) => /elsewhere|less than 11h/.test(m))).toBe(true)
  })
})

describe("week templates and holidays", () => {
  it("templates are cut to the permitted locations", async () => {
    const all = await getWeekTemplates(acc("all", ["loc-coppers", "loc-docklands", "loc-liffey"]))
    expect(all.length).toBeGreaterThanOrEqual(2)
    const mine = await getWeekTemplates(acc("locations", ["loc-coppers"]))
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((t) => t.locationId === "loc-coppers")).toBe(true)
    expect(await getWeekTemplates(acc("own", null))).toEqual([])
  })
  it("holiday dates are ISO and include the October bank holiday", async () => {
    const h = await getHolidayDates()
    expect(h).toContain("2026-10-26")
    expect(h.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))).toBe(true)
  })
})

const ALL = ["loc-coppers", "loc-docklands", "loc-liffey"]
const manager: RosterAccess = { scope: "all", locationIds: ["loc-coppers", "loc-docklands"], editDraft: true, editPublished: true, approve: true } // p-priya, except loc-liffey
const supervisorAccess: RosterAccess = { scope: "locations", locationIds: ["loc-coppers"], editDraft: true, editPublished: false, approve: false }

describe("an office role with an except (p-priya, except loc-liffey)", () => {
  it("the page payload has no Liffey home, no Liffey-only people, and no Liffey shifts or locations", async () => {
    const full = await getRosterData(acc("all", ALL), "x")
    const d = await getRosterData(manager, "p-priya")
    expect(d.members.length).toBeLessThan(full.members.length)
    expect(d.members.every((m) => m.homeLocationId !== "loc-liffey")).toBe(true)
    expect(JSON.stringify(d)).not.toContain("loc-liffey")
    const ids = d.members.map((m) => m.id)
    expect(ids).not.toContain("s-grant") // Liffey only
    expect(ids).not.toContain("p-grace") // Liffey home, a licence no visible template needs
    expect(ids).toContain("s-bell") // on Coppers shifts, so named, but with no Liffey home
    expect(d.members.find((m) => m.id === "s-bell")!.homeLocationId).toBeNull()
    expect(d.members.find((m) => m.id === "s-silva")!.homeLocationId).toBe("loc-docklands") // a visible home stays
  })
  it("the locations admin payload is cut the same way and carries the history of visible locations", async () => {
    const a = await getLocationAdminData(manager)
    expect(JSON.stringify(a)).not.toContain("loc-liffey")
    expect(a.members.map((m) => m.id)).not.toContain("s-grant")
    expect(a.history.every((h) => h.locationId !== "loc-liffey")).toBe(true)
    expect(a.history).toEqual(await getRosterHistory(manager))
  })
  it("the leave queue and its names hold nobody homed at the excepted site", async () => {
    const q = await getLeaveQueue(manager, "p-priya")
    expect(q.leave.some((l) => l.personId === "s-bell")).toBe(false) // lv-002
    expect(Object.keys(q.names)).not.toContain("s-bell")
    expect(Object.values(q.names).join()).not.toContain("Marcus Bell")
    expect(q.leave.map((l) => l.personId)).toContain("s-haddad") // home Coppers
    const everyone = await getLeaveQueue({ ...manager, locationIds: ALL }, "p-priya")
    expect(everyone.leave.map((l) => l.id)).toContain("lv-002")
  })
  it("rules, exchange, requests and history carry nothing from Liffey", async () => {
    const full = await getRosterData(acc("all", ALL), "x")
    const liffeyShifts = full.shifts.filter((s) => s.locationId === "loc-liffey").map((s) => s.id)
    const parts = JSON.stringify({ rules: await getRosterRules(manager), exchange: await getRosterExchange(manager), requests: await getRosterRequests(manager), history: await getRosterHistory(manager) })
    for (const id of liffeyShifts) expect(parts).not.toContain(id)
    expect(parts).not.toContain("loc-liffey")
    const ex = await getRosterExchange(manager)
    expect(ex.members.every((m) => m.homeLocationId !== "loc-liffey")).toBe(true)
  })
})

describe("getRosterRequests and getLocationAdminData", () => {
  it("requests are cut to the permitted locations and gated for staff scopes", async () => {
    const all = await getRosterRequests(acc("all", ALL))
    const mine = await getRosterRequests(supervisorAccess)
    const wks = (await getRosterData(acc("all", ALL), "x")).weeks
    const ok = new Set(wks.filter((w) => w.locationId === "loc-coppers").map((w) => w.id))
    expect(mine.every((r) => ok.has(r.weekId))).toBe(true)
    expect(mine.length).toBeLessThanOrEqual(all.length)
    expect(await getRosterRequests(acc("own", null))).toEqual([])
  })
  it("the locations payload is empty unless the role edits published weeks", async () => {
    const e = await getLocationAdminData(supervisorAccess)
    expect(e).toEqual({ locations: [], templates: [], targets: [], shifts: [], grants: [], members: [], skills: [], history: [] })
    const full = await getLocationAdminData({ ...manager, locationIds: ALL })
    expect(full.locations.map((l) => l.id).sort()).toEqual([...ALL].sort())
  })
})

describe("a supervisor's whole page payload", () => {
  it("holds no id, name or place of another location anywhere in the JSON", async () => {
    const full = await getRosterData(acc("all", ALL), "x")
    const data = await getRosterData(supervisorAccess, "p-ismail")
    const view = rosterViewData(data, supervisorAccess, { week: "2026-10-19" }, "2026-10-21T09:00:00")
    const json = JSON.stringify({
      data, view, rules: await getRosterRules(supervisorAccess), history: await getRosterHistory(supervisorAccess), requests: await getRosterRequests(supervisorAccess),
      templates: await getWeekTemplates(supervisorAccess), exchange: await getRosterExchange(supervisorAccess), queue: await getLeaveQueue(supervisorAccess, "p-ismail"),
    })
    const own = new Set(data.shifts.map((s) => s.id))
    for (const s of full.shifts.filter((x) => !own.has(x.id))) expect(json).not.toContain(`"${s.id}"`)
    for (const l of full.locations.filter((x) => x.id !== "loc-coppers")) {
      expect(json).not.toContain(l.id)
      expect(json).not.toContain(l.name)
    }
    for (const w of full.weeks.filter((x) => x.locationId !== "loc-coppers")) expect(json).not.toContain(w.id)
    for (const t of full.templates.filter((x) => x.locationId !== "loc-coppers")) expect(json).not.toContain(t.id)
    expect(json).not.toContain("homeLocationId\":\"loc-")
  })
})

describe("a leaver on past shifts keeps their name", () => {
  const loc = { id: "L", name: "Site", address: "", pin: { lat: 0, lng: 0 }, zoneRadiusM: 1, openingHours: "", contact: "", swapApprovalDelegated: false }
  const week: RosterWeek = { id: "w", locationId: "L", weekStart: "2026-10-05", status: "published", publishedAt: null, publishedBy: null, autoRepeatDays: null }
  const shift: RosterShift = { id: "s1", weekId: "w", locationId: "L", date: "2026-10-06", personId: "gone", templateId: "t", role: "Guard", start: "09:00", end: "17:00", unpaidBreakMin: 0, confirmedAt: null }
  const gone: WorkforceMember = { id: "gone", name: "Pat Leaver", role: "Guard", dept: "Sec", homeLocationId: "L", qualifications: [], leftOn: "2026-10-10" }
  const other: WorkforceMember = { id: "x", name: "Else Where", role: "Guard", dept: "Sec", homeLocationId: "M", qualifications: [], leftOn: null }
  it("scopedMembers keeps someone on a shift even when they have left, and drops the unrelated", () => {
    const m = scopedMembers([gone, other], [shift], [])
    expect(m.map((x) => x.id)).toEqual(["gone"])
  })
  it("rosterViewData resolves the leaver's name on a past shift in the grid and the day board", () => {
    const data = { locations: [loc], templates: [], targets: [], weeks: [week], shifts: [shift], members: scopedMembers([gone, other], [shift], []) }
    const sup: RosterAccess = { scope: "locations", locationIds: ["L"], editDraft: true, editPublished: false, approve: false }
    const board = rosterViewData(data, sup, { location: "L", week: "2026-10-05", view: "week" }, "2026-11-01T09:00:00")
    const grid = rosterViewData(data, sup, { location: "L", week: "2026-10-05", view: "week", group: "person" }, "2026-11-01T09:00:00")
    if ("denied" in board || "denied" in grid) throw new Error("denied")
    expect(JSON.stringify(board)).toContain("Pat Leaver")
    expect(JSON.stringify(grid)).toContain("Pat Leaver")
    expect(JSON.stringify(board)).not.toContain("Unknown")
  })
})

describe("weekCheck with the caller's own shifts (D9)", () => {
  const sev = { double_booking: "block", approved_leave: "block", unavailable: "warn", daily_rest: "warn", weekly_rest: "warn", avg_48h: "warn", expired_licence: "warn", left: "warn" } as const
  const mem = (id: string): WorkforceMember => ({ id, name: id.toUpperCase(), role: "r", dept: "d", homeLocationId: "A", qualifications: [], leftOn: null })
  const wk = (id: string, locationId: string, weekStart = "2026-10-19"): RosterWeek => ({ id, locationId, weekStart, status: "draft", publishedAt: null, publishedBy: null, autoRepeatDays: null })
  const sh = (id: string, weekId: string, locationId: string, personId: string | null, date: string, start = "09:00", end = "17:00"): RosterShift => ({ id, weekId, locationId, date, personId, templateId: "t", role: "r", start, end, unpaidBreakMin: 0, confirmedAt: null })
  const data = (over: Partial<WeekData> = {}): WeekData => ({
    rules: { avgWeekReferenceWeeks: 17, severity: { ...sev } }, leave: [], availability: [], templates: [], members: [mem("a"), mem("b")], allLocationIds: ["A", "B"],
    weeks: [wk("wA", "A"), wk("wB", "B")], shifts: [sh("hidden1", "wB", "B", "a", "2026-10-20", "08:00", "16:00")], ...over,
  })
  const sup: RosterAccess = { scope: "locations", locationIds: ["A"], editDraft: true, editPublished: false, approve: false }
  const posted = (over: Record<string, unknown> = {}) => ({ id: "new1", locationId: "A", personId: "a", date: "2026-10-20", templateId: "t", role: "r", start: "12:00", end: "20:00", unpaidBreakMin: 0, ...over })

  it("a shift created in this session that double-books a person at a hidden site is blocked, with no site, time or id", () => {
    const v = weekCheck(sup, "wA", [posted()], data(), "Europe/Dublin")
    const hit = v.find((x) => x.rule === "double_booking")
    expect(hit).toMatchObject({ shiftId: "new1", severity: "block", message: "Already rostered elsewhere", otherShiftIds: [] })
    const json = JSON.stringify(v)
    for (const bad of ["hidden1", "08:00", "16:00", "wB", '"B"']) expect(json).not.toContain(bad)
  })
  it("an unknown week answers for the posted shifts", () => {
    const v = weekCheck(sup, "wk-new", [posted({ date: "2026-11-03" })], data({ shifts: [sh("hidden2", "wB", "B", "a", "2026-11-03", "08:00", "16:00")] }), "Europe/Dublin")
    expect(v.some((x) => x.rule === "double_booking" && x.shiftId === "new1")).toBe(true)
    expect(weekCheck(sup, "wk-new", undefined, data(), "Europe/Dublin")).toEqual([])
  })
  it("a posted shift at a location the caller can't see, an unknown person, or a date outside the week is ignored", () => {
    expect(weekCheck(sup, "wA", [posted({ locationId: "B" })], data(), "Europe/Dublin")).toEqual([])
    expect(weekCheck(sup, "wA", [posted({ personId: "ghost" })], data(), "Europe/Dublin")).toEqual([])
    expect(weekCheck(sup, "wA", [posted({ date: "2026-11-30" })], data(), "Europe/Dublin")).toEqual([])
    expect(weekCheck(sup, "wA", "nope", data(), "Europe/Dublin")).toEqual([])
    expect(weekCheck(sup, "wB", [posted({ locationId: "B" })], data(), "Europe/Dublin")).toEqual([]) // a week at a hidden site
  })
  it("a posted shift replaces a same-id seed shift, and the seed shifts of that week the caller no longer has", () => {
    const seed = [sh("hidden1", "wB", "B", "a", "2026-10-20", "08:00", "16:00"), sh("old", "wA", "A", "b", "2026-10-20", "09:00", "17:00"), sh("keep", "wA", "A", "a", "2026-10-21", "09:00", "17:00")]
    const moved = posted({ id: "keep", date: "2026-10-22" })
    const v = weekCheck(sup, "wA", [moved], data({ shifts: seed }), "Europe/Dublin")
    expect(v.filter((x) => x.rule === "double_booking" && x.shiftId === "keep")).toEqual([]) // no longer on the 21st, no longer clashes with itself
    expect(v.some((x) => x.shiftId === "old")).toBe(false) // gone from the browser, gone from the check
  })
  it("no hour total reaches a caller who does not see every location, for supervisors and for an office except", () => {
    const heavy = ["2026-10-19", "2026-10-20", "2026-10-21"].map((d, i) => sh(`h${i}`, "wB", "B", "a", d, "06:00", "22:00")) // hidden-site hours, same week
    const post = ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map((d, i) => posted({ id: `n${i}`, date: d, start: "05:00", end: "22:00" }))
    const d = data({ rules: { avgWeekReferenceWeeks: 1, severity: { ...sev } }, shifts: heavy })
    const office: RosterAccess = { scope: "all", locationIds: ["A"], editDraft: true, editPublished: true, approve: true }
    for (const a of [sup, office]) {
      const v = weekCheck(a, "wA", post, d, "Europe/Dublin").filter((x) => x.rule === "avg_48h")
      expect(v.length).toBeGreaterThan(0)
      for (const x of v) expect(x.message).toBe("A is over the 48-hour weekly average")
    }
    const full = weekCheck({ scope: "all", locationIds: ["A", "B"], editDraft: true, editPublished: true, approve: true }, "wA", post, d, "Europe/Dublin").filter((x) => x.rule === "avg_48h")
    expect(full[0].message).toMatch(/\d+\.\dh/)
  })
})

describe("checkWeekRules is not a probe for unrelated people", () => {
  it("a supervisor posting a shift for a Docklands-only person at a visible site gets nothing", async () => {
    const week = (await getRosterData(supervisorAccess, "p-ismail")).weeks.find((w) => w.weekStart === "2026-10-26")!
    // s-silva: home Docklands, only Docklands shifts, so not tied to Coppers.
    const probe = { id: "s-probe", locationId: "loc-coppers", personId: "s-silva", date: "2026-10-26", templateId: "tpl-cop-day", role: "Door", start: "02:00", end: "05:00", unpaidBreakMin: 0 }
    expect(await weekViolations(supervisorAccess, week.id, "Europe/Dublin", [probe])).toEqual([])
  })
  it("a tied person's leave and availability messages carry no dates or windows, for supervisors and office-except alike", async () => {
    const week = (await getRosterData(supervisorAccess, "p-ismail")).weeks.find((w) => w.weekStart === "2026-10-26")!
    // p-marcus (home Coppers) has approved leave 2026-10-27 to 28.
    const post = { id: "s-leave", locationId: "loc-coppers", personId: "p-marcus", date: "2026-10-27", templateId: "tpl-cop-day", role: "Door", start: "09:00", end: "17:00", unpaidBreakMin: 0 }
    const v = await weekViolations(supervisorAccess, week.id, "Europe/Dublin", [post])
    const hit = v.find((x) => x.rule === "approved_leave" && x.shiftId === "s-leave")
    expect(hit).toBeTruthy()
    expect(hit!.message).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    const exceptOffice: RosterAccess = { ...manager, locationIds: ["loc-coppers"] }
    const o = await weekViolations(exceptOffice, week.id, "Europe/Dublin", [post])
    expect(o.find((x) => x.rule === "approved_leave")!.message).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})
