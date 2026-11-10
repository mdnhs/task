import { describe, expect, it } from "vitest"
import { autoRepeatDue, applyWeekTemplate, repeatWeek, saveWeekTemplate } from "./roster-repeat"
import type { RuleContext, RuleId } from "./roster-rules"
import type { RosterShift, RosterWeek, ShiftTemplate } from "./rosters"
import type { WorkforceMember } from "./workforce"

const TZ = "Europe/Dublin"
const SEV: Record<RuleId, "block" | "warn"> = { double_booking: "block", approved_leave: "block", unavailable: "warn", daily_rest: "block", weekly_rest: "warn", avg_48h: "warn", expired_licence: "block", left: "block" }
const member = (id: string, o: Partial<WorkforceMember> = {}): WorkforceMember => ({ id, name: id.toUpperCase(), role: "Security Officer", dept: "Ops", homeLocationId: "a", qualifications: [], leftOn: null, ...o })
const tpl: ShiftTemplate = { id: "t1", locationId: "a", name: "Day", start: "12:00", end: "18:00", unpaidBreakMin: 0, role: "Security Officer", requires: [] }
const tplB: ShiftTemplate = { ...tpl, id: "t1b", locationId: "b" }
const week = (o: Partial<RosterWeek> = {}): RosterWeek => ({ id: "w1", locationId: "a", weekStart: "2026-11-02", status: "published", publishedAt: "2026-10-28T10:00:00", publishedBy: "me", autoRepeatDays: null, ...o })
let n = 0
const shift = (date: string, personId: string | null, o: Partial<RosterShift> = {}): RosterShift =>
  ({ id: `s${++n}`, weekId: "w1", locationId: "a", date, personId, templateId: "t1", role: "Security Officer", start: "12:00", end: "18:00", unpaidBreakMin: 0, confirmedAt: "2026-10-30T09:00:00", ...o })
const ctx = (shifts: RosterShift[], o: Partial<RuleContext> = {}): RuleContext => ({
  shifts, members: [member("p1"), member("p2"), member("p3")], leave: [], availability: [], templates: [tpl, tplB], severity: SEV, avgWeekReferenceWeeks: 17, tz: TZ, visibleLocationIds: null, ...o,
})
const idList = (k: number) => Array.from({ length: k }, (_, i) => `n${i}`)
const src = [shift("2026-11-02", "p1"), shift("2026-11-03", "p2"), shift("2026-11-04", "p1", { start: "09:00", end: "15:00" })]

describe("repeatWeek", () => {
  it("copies people and times, dates +7, draft, confirmedAt null (AC-RS-06)", () => {
    const r = repeatWeek(week(), src, "2026-11-09", null, false, ctx(src), [], idList(4))
    expect(r.week).toMatchObject({ locationId: "a", weekStart: "2026-11-09", status: "draft", publishedAt: null, publishedBy: null })
    expect(r.shifts.map((s) => [s.date, s.personId, s.start, s.end])).toEqual([["2026-11-09", "p1", "12:00", "18:00"], ["2026-11-10", "p2", "12:00", "18:00"], ["2026-11-11", "p1", "09:00", "15:00"]])
    expect(r.shifts.every((s) => s.weekId === r.week.id && s.confirmedAt === null && s.locationId === "a")).toBe(true)
    expect(new Set(r.shifts.map((s) => s.id)).size).toBe(3)
    expect(r.conflicts).toEqual([])
  })
  it("approved leave opens the shift and keeps the count (never dropped)", () => {
    const leave = [{ id: "l", personId: "p2", from: "2026-11-10", to: "2026-11-10", kind: "annual", status: "approved" as const, decidedBy: "x", decidedAt: "2026-11-01T00:00:00" }]
    const r = repeatWeek(week(), src, "2026-11-09", null, false, ctx(src, { leave }), [], idList(4))
    expect(r.shifts).toHaveLength(3)
    expect(r.shifts[1].personId).toBeNull()
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0]).toMatchObject({ shiftId: r.shifts[1].id, personId: "p2", reason: "approved_leave", open: true })
  })
  it("a public holiday keeps the person with an info conflict", () => {
    const r = repeatWeek(week(), src, "2026-11-09", null, false, ctx(src), ["2026-11-10"], idList(4))
    expect(r.shifts[1].personId).toBe("p2")
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0]).toMatchObject({ reason: "public_holiday", open: false, shiftId: r.shifts[1].id })
  })
  it("a copy clashing with an existing shift of another week opens", () => {
    const a = shift("2026-11-02", "p1")
    const b = shift("2026-11-03", "p1")
    const moved = repeatWeek(week(), [a, b], "2026-11-09", null, false, ctx([a, b, shift("2026-11-10", "p1", { weekId: "other" })]), [], idList(3))
    expect(moved.shifts[0].personId).toBe("p1")
    expect(moved.shifts[1].personId).toBeNull()
    expect(moved.conflicts.map((c) => c.open)).toEqual([true])
  })
  it("two copied shifts that clash with each other: the second opens", () => {
    const a = shift("2026-11-02", "p1")
    const b = shift("2026-11-02", "p1", { start: "15:00", end: "20:00" })
    const r = repeatWeek(week(), [a, b], "2026-11-09", null, false, ctx([a, b]), [], idList(3))
    expect(r.shifts.map((s) => s.personId)).toEqual(["p1", null])
    expect(r.conflicts).toMatchObject([{ reason: "double_booking", open: true }])
  })
  it("open conflicts equal the number of failing shifts", () => {
    const leave = [1, 2].map((i) => ({ id: `l${i}`, personId: i === 1 ? "p1" : "p2", from: "2026-11-09", to: "2026-11-12", kind: "annual", status: "approved" as const, decidedBy: "x", decidedAt: "2026-11-01T00:00:00" }))
    const r = repeatWeek(week(), src, "2026-11-09", null, false, ctx(src, { leave }), ["2026-11-09"], idList(4))
    expect(r.conflicts.filter((c) => c.open)).toHaveLength(3)
    expect(r.shifts.filter((s) => s.personId === null)).toHaveLength(3)
    expect(r.conflicts).toHaveLength(3)
  })
  it("a warn-severity violation keeps the person and adds an info conflict", () => {
    const availability = [{ personId: "p2", weekday: 2 as const, from: "10:00", to: "20:00" }] // Tue 10 Nov (unavailable is warn)
    const r = repeatWeek(week(), src, "2026-11-09", null, false, ctx(src, { availability }), [], idList(4))
    expect(r.shifts.map((s) => s.personId)).toEqual(["p1", "p2", "p1"])
    expect(r.conflicts).toMatchObject([{ reason: "unavailable", open: false, personId: "p2" }])
    expect(r.conflicts[0].message).toContain("P2")
  })
  it("warns do not cascade across N weeks: every week keeps its people", () => {
    const availability = [{ personId: "p2", weekday: 2 as const, from: "10:00", to: "20:00" }]
    let all = [...src]
    for (const start of ["2026-11-09", "2026-11-16"]) {
      const r = repeatWeek(week(), src, start, null, false, ctx(all, { availability }), [], [`w-${start}`, ...idList(3).map((i) => `${start}-${i}`)])
      expect(r.shifts.every((s) => s.personId !== null)).toBe(true)
      all = [...all, ...r.shifts]
    }
  })
  it("open source shifts stay open without a conflict", () => {
    const o = [shift("2026-11-02", null)]
    const r = repeatWeek(week(), o, "2026-11-09", null, false, ctx(o), [], idList(2))
    expect(r.shifts[0].personId).toBeNull()
    expect(r.conflicts).toEqual([])
  })
  it("a published target throws; a draft target needs replace", () => {
    expect(() => repeatWeek(week(), src, "2026-11-09", week({ id: "t", weekStart: "2026-11-09" }), true, ctx(src), [], idList(4))).toThrow(/published/i)
    const draft = week({ id: "t", weekStart: "2026-11-09", status: "draft", publishedAt: null, publishedBy: null })
    expect(() => repeatWeek(week(), src, "2026-11-09", draft, false, ctx(src), [], idList(4))).toThrow(/replace/i)
  })
  it("replace swaps the old shifts: no duplicates, old ones ignored by the check", () => {
    const draft = week({ id: "t", weekStart: "2026-11-09", status: "draft", publishedAt: null, publishedBy: null })
    const old = [shift("2026-11-09", "p1", { weekId: "t" }), shift("2026-11-09", "p1", { weekId: "t", start: "13:00", end: "17:00" })]
    const r = repeatWeek(week(), src, "2026-11-09", draft, true, ctx([...src, ...old]), [], idList(4))
    expect(r.week.id).toBe("t")
    expect(r.shifts).toHaveLength(3)
    expect(r.shifts.some((s) => old.some((o) => o.id === s.id))).toBe(false)
    expect(r.conflicts).toEqual([])
    const store = [...src, ...old].filter((s) => s.weekId !== r.week.id).concat(r.shifts)
    expect(store.filter((s) => s.weekId === "t")).toHaveLength(3)
  })
  it("repeating over N weeks is N sequential calls, each draft, with the previous result in ctx", () => {
    let all = [...src]
    let from = week()
    const made: RosterWeek[] = []
    for (const start of ["2026-11-09", "2026-11-16", "2026-11-23"]) {
      const r = repeatWeek(from, all.filter((s) => s.weekId === from.id), start, null, false, ctx(all), [], [`w-${start}`, ...idList(3).map((i) => `${start}-${i}`)])
      made.push(r.week)
      all = [...all, ...r.shifts]
      from = r.week
    }
    expect(made.map((w) => w.status)).toEqual(["draft", "draft", "draft"])
    expect(made.map((w) => w.weekStart)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"])
    expect(all).toHaveLength(12)
    expect(new Set(all.map((s) => s.id)).size).toBe(12)
  })
  it("rejects a target that is not a Monday", () => {
    expect(() => repeatWeek(week(), src, "2026-11-10", null, false, ctx(src), [], idList(4))).toThrow(/Monday/)
  })
})

describe("autoRepeatDue", () => {
  const w = (id: string, loc: string, start: string, status: RosterWeek["status"], days: number | null) => week({ id, locationId: loc, weekStart: start, status, autoRepeatDays: days })
  it("is due when next week is within autoRepeatDays and not drafted", () => {
    const due = autoRepeatDue([w("a", "a", "2026-11-02", "published", 7)], "2026-11-04")
    expect(due.map((x) => x.id)).toEqual(["a"])
  })
  it("not due when the next week already exists, is too far off, or no setting", () => {
    expect(autoRepeatDue([w("a", "a", "2026-11-02", "published", 7), w("b", "a", "2026-11-09", "draft", null)], "2026-11-04")).toEqual([])
    expect(autoRepeatDue([w("a", "a", "2026-11-02", "published", 7)], "2026-11-01")).toEqual([])
    expect(autoRepeatDue([w("a", "a", "2026-11-02", "published", null)], "2026-11-04")).toEqual([])
    expect(autoRepeatDue([w("a", "a", "2026-11-02", "published", 7), w("b", "c", "2026-11-09", "draft", null)], "2026-11-04")).toHaveLength(1)
  })
})

describe("week templates", () => {
  const wk = week({ id: "w1" })
  it("saves a named template from a week and applies it as a draft", () => {
    const t = saveWeekTemplate("  Standard  ", wk, src, "wt1")
    expect(t).toMatchObject({ id: "wt1", name: "Standard", locationId: "a" })
    expect(t.shifts.map((s) => s.day)).toEqual([0, 1, 2])
    const r = applyWeekTemplate(t, "a", "2026-11-16", ctx(src), [], idList(4))
    expect(r.week).toMatchObject({ locationId: "a", weekStart: "2026-11-16", status: "draft" })
    expect(r.shifts.map((s) => s.date)).toEqual(["2026-11-16", "2026-11-17", "2026-11-18"])
    expect(r.shifts.map((s) => s.personId)).toEqual(["p1", "p2", "p1"])
  })
  it("rejects an empty name", () => {
    expect(() => saveWeekTemplate("  ", wk, src, "x")).toThrow()
  })
  it("applied to a different location, people not in that workforce become open shifts", () => {
    const t = saveWeekTemplate("Std", wk, src, "wt1")
    const members = [member("p1", { homeLocationId: "b" }), member("p2", { homeLocationId: "a" }), member("p3")]
    const r = applyWeekTemplate(t, "b", "2026-11-16", ctx(src, { members }), [], idList(4))
    expect(r.week.locationId).toBe("b")
    expect(r.shifts.every((s) => s.locationId === "b")).toBe(true)
    expect(r.shifts.slice(0, 2).every((s) => s.templateId === "t1b")).toBe(true) // same times: the other location's own shift type
    expect(r.shifts.map((s) => s.personId)).toEqual(["p1", null, "p1"])
    expect(r.conflicts.filter((c) => c.open)).toHaveLength(1)
    expect(r.conflicts[0].personId).toBe("p2")
  })
  it("another location with no matching shift type clears the dangling templateId", () => {
    const t = saveWeekTemplate("Std", wk, src, "wt1")
    const members = [member("p1", { homeLocationId: "b" }), member("p2", { homeLocationId: "b" })]
    const r = applyWeekTemplate(t, "b", "2026-11-16", ctx(src, { members }), [], idList(4))
    expect(r.shifts[2].templateId).toBe("") // 09:00-15:00 has no match at b
    expect(r.shifts[0].templateId).toBe("t1b")
  })
  it("refuses a week that already has shifts at that location", () => {
    const t = saveWeekTemplate("Std", wk, src, "wt1")
    const there = shift("2026-11-18", "p3", { weekId: "x" })
    expect(() => applyWeekTemplate(t, "a", "2026-11-16", ctx([...src, there]), [], idList(4))).toThrow(/already/i)
    expect(() => applyWeekTemplate(t, "b", "2026-11-16", ctx([...src, there]), [], idList(4))).not.toThrow()
  })
  it("rules apply on template apply too", () => {
    const t = saveWeekTemplate("Std", wk, src, "wt1")
    const leave = [{ id: "l", personId: "p1", from: "2026-11-16", to: "2026-11-16", kind: "annual", status: "approved" as const, decidedBy: "x", decidedAt: "2026-11-01T00:00:00" }]
    const r = applyWeekTemplate(t, "a", "2026-11-16", ctx(src, { leave }), [], idList(4))
    expect(r.shifts[0].personId).toBeNull()
    expect(r.conflicts).toMatchObject([{ reason: "approved_leave", open: true }])
  })
})
