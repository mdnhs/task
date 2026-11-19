import { describe, expect, it } from "vitest"
import { MAX_WEEKS, repeatBlocked, repeatBody, repeatPlan, repeatSummary } from "./repeating"
import type { RepeatConflict, WeekRoster } from "./types"

const acc = { level: "office", canEdit: true, locked: false, lockReason: null } as const
const wk = (weekStart: string, status: "draft" | "published", version = 1, locationId = "L1"): WeekRoster => ({ id: `w-${weekStart}`, locationId, weekStart, status, publishedAt: null, publishedBy: null, autoRepeatDays: null, version, days: [], access: acc })
const src = { locationId: "L1", weekStart: "2026-11-02" }

describe("repeat plan", () => {
  it("lists the next Mondays (1..12) with what is already there", () => {
    const p = repeatPlan(src, 3, [wk("2026-11-09", "draft", 4), wk("2026-11-16", "published"), wk("2026-11-23", "draft", 1, "L2")])
    expect(p.targets.map((t) => t.monday)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"])
    expect(p.targets.map((t) => t.week?.status ?? null)).toEqual(["draft", "published", null]) // another location's week is not a target
    expect([p.drafts, p.published]).toEqual([1, 1])
    expect(repeatPlan(src, 99, []).targets).toHaveLength(MAX_WEEKS)
    expect(repeatPlan(src, 0, []).targets).toHaveLength(1)
  })
  it("a published week blocks it; a draft needs replace", () => {
    expect(repeatBlocked(repeatPlan(src, 1, [wk("2026-11-09", "published")]), true)).toBe(true)
    const draft = repeatPlan(src, 1, [wk("2026-11-09", "draft")])
    expect(repeatBlocked(draft, false)).toBe(true)
    expect(repeatBlocked(draft, true)).toBe(false)
    expect(repeatBlocked(repeatPlan(src, 2, []), false)).toBe(false)
  })
  it("replace sends the version of every draft it replaces, by Monday; a plain repeat sends none", () => {
    const p = repeatPlan(src, 3, [wk("2026-11-09", "draft", 4), wk("2026-11-23", "draft", 7)])
    expect(repeatBody({ version: 3 }, p, false)).toEqual({ version: 3, weeks: 3 })
    expect(repeatBody({ version: 3 }, p, true)).toEqual({ version: 3, weeks: 3, replace: true, targetVersions: { "2026-11-09": 4, "2026-11-23": 7 } })
  })
  it("counts kept, warned and open from the answer", () => {
    const c = (open: boolean): RepeatConflict => ({ weekId: "w", shiftId: "s", personId: "p", date: "2026-11-09", reason: "x", open, message: "m" })
    expect(repeatSummary({ copied: 12, kept: 9, warned: 2, opened: 1 }, [c(true), c(false), c(false)])).toEqual({ copied: 12, kept: 9, warned: 2, opened: 1, open: 1, info: 2 })
  })
})
