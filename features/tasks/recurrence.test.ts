import { describe, expect, it } from "vitest"

import { describeRepeat, nextOccurrences, repeatError, weekdayOf } from "./recurrence"

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
