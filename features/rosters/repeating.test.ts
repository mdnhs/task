import { describe, expect, it } from "vitest"
import type { RosterAccess } from "@/lib/roster-access"
import type { RuleContext } from "@/lib/roster-rules"
import type { RosterShift, RosterWeek } from "@/lib/rosters"
import { applyTemplateChecked, repeatChecked, repeatManyChecked, saveTemplateChecked } from "./repeating"

const acc = (o: Partial<RosterAccess> = {}): RosterAccess => ({ scope: "locations", locationIds: ["a"], editDraft: true, editPublished: false, approve: false, ...o })
const wk: RosterWeek = { id: "w1", locationId: "a", weekStart: "2026-11-02", status: "published", publishedAt: "x", publishedBy: "y", autoRepeatDays: null }
const sh: RosterShift = { id: "s1", weekId: "w1", locationId: "a", date: "2026-11-02", personId: "p1", templateId: "t", role: "r", start: "12:00", end: "18:00", unpaidBreakMin: 0, confirmedAt: null }
const ctx: RuleContext = { shifts: [sh], members: [], leave: [], availability: [], templates: [], severity: { double_booking: "block", approved_leave: "block", unavailable: "warn", daily_rest: "block", weekly_rest: "warn", avg_48h: "warn", expired_licence: "block", left: "block" }, avgWeekReferenceWeeks: 17, tz: "Europe/Dublin", visibleLocationIds: ["a"] }

describe("repeat with access", () => {
  it("repeats a published week into a new draft and logs it on the new week", () => {
    const r = repeatChecked(acc(), wk, [sh], "2026-11-09", null, false, ctx, [], ["nw", "n1"], "me", "2026-11-04T10:00:00")
    expect(r.week.status).toBe("draft")
    expect(r.entry).toMatchObject({ weekId: "nw", action: "repeat", locationId: "a" })
  })
  it("refuses a role that cannot edit, and a location the role can't see", () => {
    expect(() => repeatChecked(acc({ editDraft: false }), wk, [sh], "2026-11-09", null, false, ctx, [], ["nw", "n1"], "me", "t")).toThrow()
    expect(() => repeatChecked(acc({ locationIds: ["z"] }), wk, [sh], "2026-11-09", null, false, ctx, [], ["nw", "n1"], "me", "t")).toThrow(/access/i)
  })
  it("saves and applies a template with history, and refuses another location", () => {
    const t = saveTemplateChecked(acc(), "Std", wk, [sh], "wt")
    const r = applyTemplateChecked(acc(), t, "a", "2026-11-16", [], ctx, [], ["nw", "n1"], "me", "2026-11-04T10:00:00")
    expect(r.entry).toMatchObject({ weekId: "nw", action: "template-apply" })
    expect(() => applyTemplateChecked(acc({ locationIds: ["a"] }), t, "b", "2026-11-16", [], ctx, [], ["nw", "n1"], "me", "t")).toThrow(/access/i)
    expect(() => saveTemplateChecked(acc({ locationIds: [] }), "Std", wk, [sh], "wt")).toThrow(/access/i)
  })
})

const draftAt = (id: string, start: string, loc = "a"): RosterWeek => ({ id, locationId: loc, weekStart: start, status: "draft", publishedAt: null, publishedBy: null, autoRepeatDays: null })
let k = 0
const idsFor = (target: string, _taken: RosterShift[], count: number) => [`nw-${target}`, ...Array.from({ length: count }, () => `ns${++k}`)]
const many = (weeks: RosterWeek[], all: RosterShift[], count: number, replace: boolean, a = acc()) => repeatManyChecked(a, wk, all, weeks, count, replace, { ...ctx, shifts: all }, [], idsFor, "me", "2026-11-04T10:00:00")

describe("repeatManyChecked", () => {
  it("makes N drafts and one history line per week", () => {
    const r = many([wk], [sh], 3, false)
    expect(r.weeks.filter((w) => w.status === "draft")).toHaveLength(3)
    expect(r.shifts).toHaveLength(4)
    expect(r.entries).toHaveLength(3)
  })
  it("a published week in the middle writes nothing", () => {
    const mid = { ...draftAt("pub", "2026-11-16"), status: "published" as const }
    expect(() => many([wk, mid], [sh], 3, true)).toThrow(/published/i)
  })
  it("replace over two drafts leaves no duplicates", () => {
    const d1 = draftAt("d1", "2026-11-09")
    const d2 = draftAt("d2", "2026-11-16")
    const old = [d1, d2].map((d, i) => ({ ...sh, id: `old${i}`, weekId: d.id, date: d.weekStart }))
    const r = many([wk, d1, d2], [sh, ...old], 2, true)
    expect(r.shifts.filter((s) => s.weekId === "d1")).toHaveLength(1)
    expect(r.shifts.filter((s) => s.weekId === "d2")).toHaveLength(1)
    expect(r.shifts.some((s) => s.id.startsWith("old"))).toBe(false)
    expect(r.weeks.filter((w) => w.weekStart === "2026-11-09")).toHaveLength(1)
  })
  it("a draft target without replace throws and nothing is returned", () => {
    expect(() => many([wk, draftAt("d1", "2026-11-09")], [sh], 1, false)).toThrow(/replace/i)
  })
})

describe("guards", () => {
  it("refuses an existing week of another location", () => {
    expect(() => repeatChecked(acc({ locationIds: ["a", "b"] }), wk, [sh], "2026-11-09", draftAt("x", "2026-11-09", "b"), true, ctx, [], ["nw", "n1"], "me", "t")).toThrow(/location/i)
  })
  it("template apply refuses a week that already exists at that location", () => {
    const t = saveTemplateChecked(acc(), "Std", wk, [sh], "wt")
    expect(() => applyTemplateChecked(acc(), t, "a", "2026-11-16", [draftAt("e", "2026-11-16")], ctx, [], ["nw", "n1"], "me", "t")).toThrow(/already/i)
  })
  it("a supervisor's local check reports nothing from a hidden site", () => {
    // The supervisor's payload holds no shift of site b, so a clash there is not found and nothing of it leaks (the server check finds it at publish).
    const mine = { ...sh, id: "m", date: "2026-11-02" }
    const hidden = { ...sh, id: "hid", locationId: "b", weekId: "wb", date: "2026-11-09" } // exists on the server only
    const r = repeatChecked(acc(), wk, [mine], "2026-11-09", null, false, { ...ctx, shifts: [mine] }, [], ["nw", "n1"], "me", "t")
    expect(r.conflicts).toEqual([])
    expect(JSON.stringify(r)).not.toContain(hidden.id)
    expect(r.shifts[0].personId).toBe("p1")
  })
})
