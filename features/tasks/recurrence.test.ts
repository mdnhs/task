import { describe, expect, it } from "vitest"

import { legacyRule } from "@/lib/task-evidence"

import { describeRepeat, materialiseRecurring, nextOccurrences, repeatError, weekdayOf } from "./recurrence"
import type { Task } from "./types"

describe("nextOccurrences", () => {
  it("daily is strictly after from, inclusive of until", () => {
    expect(nextOccurrences({ freq: "daily" }, "2026-10-20", "2026-10-23")).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"])
    expect(nextOccurrences({ freq: "daily" }, "2026-10-23", "2026-10-23")).toEqual([])
  })
  it("accepts ISO date-times and ignores the time", () => {
    expect(nextOccurrences({ freq: "daily" }, "2026-10-20T17:00:00", "2026-10-21T09:00:00")).toEqual(["2026-10-21"])
  })
  it("weekdays skip Saturday and Sunday", () => {
    expect(weekdayOf("2026-10-23")).toBe(5) // Friday
    expect(nextOccurrences({ freq: "weekdays" }, "2026-10-22", "2026-10-27")).toEqual(["2026-10-23", "2026-10-26", "2026-10-27"])
  })
  it("weekly uses the chosen days only", () => {
    expect(nextOccurrences({ freq: "weekly", days: [1, 3] }, "2026-10-19", "2026-11-02")).toEqual(["2026-10-21", "2026-10-26", "2026-10-28", "2026-11-02"])
    expect(nextOccurrences({ freq: "weekly", days: [] }, "2026-10-19", "2026-11-02")).toEqual([])
  })
  it("monthly clamps to the last day of a short month", () => {
    expect(nextOccurrences({ freq: "monthly", dayOfMonth: 31 }, "2026-01-31", "2026-05-31")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"])
    expect(nextOccurrences({ freq: "monthly", dayOfMonth: 30 }, "2028-01-31", "2028-03-31")).toEqual(["2028-02-29", "2028-03-30"])
    expect(nextOccurrences({ freq: "monthly", dayOfMonth: 15 }, "2026-12-15", "2027-02-20")).toEqual(["2027-01-15", "2027-02-15"])
  })
  it("the rule's end date caps the run, even if until is later", () => {
    expect(nextOccurrences({ freq: "daily", until: "2026-10-22" }, "2026-10-20", "2026-10-30")).toEqual(["2026-10-21", "2026-10-22"])
    expect(nextOccurrences({ freq: "daily", until: "2026-10-20" }, "2026-10-20", "2026-10-30")).toEqual([])
  })
  it("is not thrown by the clock change weekends", () => {
    expect(nextOccurrences({ freq: "daily" }, "2026-03-28", "2026-03-30")).toEqual(["2026-03-29", "2026-03-30"])
    expect(nextOccurrences({ freq: "daily" }, "2026-10-24", "2026-10-26")).toEqual(["2026-10-25", "2026-10-26"])
  })
})

const series = (over: Partial<Task> = {}): Task => ({
  ref: "TSK-1", title: "Fire test", description: "d", dept: "Security", assignee: "p1", creator: "p2", priority: 2,
  start: "2026-10-12T09:00:00", due: "2026-10-12T17:00:00", status: "completed", evidenceRule: legacyRule(true), tags: ["fire"],
  repeat: { freq: "weekly", days: [1] }, completedAt: "2026-10-12T10:00:00",
  notes: [{ at: "x", by: "y", text: "n" }], evidence: [{ id: "TSK-1-E1", kind: "pdf", name: "a", by: "b", at: "c", review: "accepted" }], timeline: [],
  ...over,
})

describe("materialiseRecurring", () => {
  it("creates the due instances up to today as fresh Not Started tasks", () => {
    const out = materialiseRecurring([series()], "2026-10-27T09:00:00")
    expect(out).toHaveLength(3)
    const added = out.filter((t) => t.seriesId)
    expect(added.map((t) => t.due).sort()).toEqual(["2026-10-19T17:00:00", "2026-10-26T17:00:00"])
    expect(added[0]).toMatchObject({ status: "not_started", seriesId: "TSK-1", evidence: [], notes: [], evidenceRule: legacyRule(true), assignee: "p1", tags: ["fire"] })
    expect(added[0].repeat).toBeUndefined()
    expect(added[0].completedAt).toBeUndefined()
    expect(added.map((t) => t.ref).sort()).toEqual(["TSK-2", "TSK-3"])
    expect(added.find((t) => t.due.startsWith("2026-10-19"))?.start).toBe("2026-10-19T09:00:00")
  })
  it("is idempotent", () => {
    const once = materialiseRecurring([series()], "2026-10-27T09:00:00")
    expect(materialiseRecurring(once, "2026-10-27T09:00:00")).toBe(once)
    const later = materialiseRecurring(once, "2026-11-03T09:00:00")
    expect(later.filter((t) => t.seriesId)).toHaveLength(3)
  })
  it("does not repeat a date an existing instance already holds, and keeps refs unique", () => {
    const have = series({ ref: "TSK-9", repeat: undefined, seriesId: "TSK-1", due: "2026-10-19T08:00:00" })
    const out = materialiseRecurring([series(), have], "2026-10-27T09:00:00")
    expect(out.filter((t) => t.due.startsWith("2026-10-19"))).toHaveLength(1)
    expect(new Set(out.map((t) => t.ref)).size).toBe(out.length)
    expect(out.find((t) => t.due.startsWith("2026-10-26"))?.ref).toBe("TSK-10")
  })
  it("stops at the end date and starts after the series' own due date", () => {
    const out = materialiseRecurring([series({ repeat: { freq: "daily", until: "2026-10-14" } })], "2026-10-30T09:00:00")
    expect(out.filter((t) => t.seriesId).map((t) => t.due.slice(0, 10)).sort()).toEqual(["2026-10-13", "2026-10-14"])
  })
  it("makes nothing for tasks without a rule, for instances, or when today is not past the due date", () => {
    const plain = series({ repeat: undefined })
    expect(materialiseRecurring([plain], "2026-10-30T09:00:00")).toEqual([plain])
    expect(materialiseRecurring([series({ seriesId: "TSK-0" })], "2026-10-30T09:00:00")).toHaveLength(1)
    const s = [series()]
    expect(materialiseRecurring(s, "2026-10-12T09:00:00")).toBe(s)
  })
  it("respects a ref floor for tasks the user cannot see", () => {
    const out = materialiseRecurring([series()], "2026-10-20T09:00:00", 50)
    expect(out[0].ref).toBe("TSK-51")
  })
})

describe("describeRepeat / repeatError", () => {
  it("describes each rule", () => {
    expect(describeRepeat({ freq: "daily" })).toBe("Daily")
    expect(describeRepeat({ freq: "weekly", days: [3, 1] })).toBe("Weekly on Mon, Wed")
    expect(describeRepeat({ freq: "monthly", dayOfMonth: 31, until: "2027-01-01" })).toBe("Monthly on day 31 until 2027-01-01")
  })
  it("validates", () => {
    expect(repeatError({ freq: "weekly", days: [] }, "2026-10-20")).toMatch(/day/)
    expect(repeatError({ freq: "monthly", dayOfMonth: 0 }, "2026-10-20")).toMatch(/1 to 31/)
    expect(repeatError({ freq: "daily", until: "2026-10-01" }, "2026-10-20")).toMatch(/End date/)
    expect(repeatError({ freq: "daily", until: "2026-10-30" }, "2026-10-20")).toBe("")
  })
})
