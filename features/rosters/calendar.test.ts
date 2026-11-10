import { describe, expect, it } from "vitest"
import type { LeaveRequest } from "@/lib/roster-rules"
import type { RosterShift } from "@/lib/rosters"
import { leaveOn, monthGrid, monthLabel, shiftMonth, shiftsByDay } from "./calendar"

const shift = (id: string, date: string, start: string, end: string): RosterShift =>
  ({ id, weekId: "w", locationId: "l", date, personId: "p", templateId: "t", role: "r", start, end, unpaidBreakMin: 0, confirmedAt: null }) as RosterShift
const leave = (id: string, from: string, to: string, status: LeaveRequest["status"]): LeaveRequest =>
  ({ id, personId: "p", from, to, kind: "Annual leave", status, decidedBy: null, decidedAt: null })

describe("monthGrid", () => {
  it("is six Monday-first weeks that hold the whole month", () => {
    const g = monthGrid("2026-10-20")
    expect(g).toHaveLength(6)
    expect(g.every((w) => w.length === 7)).toBe(true)
    expect(g[0][0]).toBe("2026-09-28") // Mon: 1 Oct 2026 is a Thursday
    expect(g.flat()).toContain("2026-10-31")
    expect(g[5][6]).toBe("2026-11-08")
  })
})

describe("shiftMonth and monthLabel", () => {
  it("moves across a year end both ways", () => {
    expect(shiftMonth("2026-12-15", 1)).toBe("2027-01-01")
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01")
    expect(monthLabel("2026-10-20")).toBe("October 2026")
  })
})

describe("shiftsByDay", () => {
  it("groups by start day, earliest first, and keeps an overnight shift on its start day", () => {
    const m = shiftsByDay([shift("b", "2026-10-20", "22:00", "06:00"), shift("a", "2026-10-20", "08:00", "16:00"), shift("c", "2026-10-21", "09:00", "17:00")])
    expect(m.get("2026-10-20")?.map((s) => s.id)).toEqual(["a", "b"])
    expect(m.get("2026-10-21")?.map((s) => s.id)).toEqual(["c"])
    expect(m.get("2026-10-22")).toBeUndefined()
  })
})

describe("leaveOn", () => {
  it("covers the first and last day, skips rejected, prefers approved", () => {
    const l = [leave("r", "2026-11-02", "2026-11-06", "rejected"), leave("q", "2026-11-04", "2026-11-05", "requested"), leave("a", "2026-11-05", "2026-11-09", "approved")]
    expect(leaveOn("2026-11-02", l)).toBeUndefined()
    expect(leaveOn("2026-11-04", l)?.id).toBe("q")
    expect(leaveOn("2026-11-05", l)?.id).toBe("a")
    expect(leaveOn("2026-11-09", l)?.id).toBe("a")
    expect(leaveOn("2026-11-10", l)).toBeUndefined()
  })
})
