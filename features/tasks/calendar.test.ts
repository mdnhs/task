import { describe, expect, it } from "vitest"

import { byDueDay, monthGrid, monthLabel, shiftMonth, weekLabel, weekOf, weekStart } from "./calendar"
import type { Task } from "./types"

describe("calendar", () => {
  it("starts weeks on Monday", () => {
    expect(weekStart("2026-10-20")).toBe("2026-10-19")
    expect(weekStart("2026-10-25")).toBe("2026-10-19")
    expect(weekOf("2026-10-20")).toHaveLength(7)
  })
  it("builds a 6-week month grid", () => {
    const g = monthGrid("2026-10-20")
    expect(g).toHaveLength(6)
    expect(g[0][0]).toBe("2026-09-28")
    expect(g[0][3]).toBe("2026-10-01")
  })
  it("moves months across years", () => {
    expect(shiftMonth("2026-12-15", 1)).toBe("2027-01-01")
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01")
  })
  it("labels and groups", () => {
    expect(monthLabel("2026-10-20")).toBe("October 2026")
    expect(weekLabel("2026-10-20")).toBe("19 Oct – 25 Oct 2026")
    const m = byDueDay([{ due: "2026-10-20T17:00:00" }, { due: "2026-10-20T09:00:00" }, { due: "2026-10-21T09:00:00" }] as Task[])
    expect(m.get("2026-10-20")?.map((t) => t.due)).toEqual(["2026-10-20T09:00:00", "2026-10-20T17:00:00"])
  })
})
