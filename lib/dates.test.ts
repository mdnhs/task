import { describe, expect, it } from "vitest"
import { daysBetween, formatDate, formatDue, formatTime, isOverdue } from "./dates"

describe("dates", () => {
  const today = "2026-10-20T09:00:00"
  it("formatDue", () => {
    expect(formatDue("2026-10-20T15:00:00", today)).toBe("Today 3:00 PM")
    expect(formatDue("2026-10-21T09:00:00", today)).toBe("Tomorrow 9:00 AM")
    expect(formatDue("2026-10-19T17:30:00", today)).toBe("Yesterday 5:30 PM")
    expect(formatDue("2026-10-22T09:00:00", today)).toBe("Thu 22 Oct")
  })
  it("formatDate", () => {
    expect(formatDate("2026-10-20T00:00:00")).toBe("Tue 20 Oct")
  })
  it("formatTime", () => {
    expect(formatTime("2026-10-20T17:30:00")).toBe("5:30 PM")
    expect(formatTime("2026-10-20T00:05:00")).toBe("12:05 AM")
    expect(formatTime("2026-10-20T12:00:00")).toBe("12:00 PM")
  })
  it("isOverdue", () => {
    expect(isOverdue("2026-10-20T12:00:00", "2026-10-20T13:00:00")).toBe(true)
    expect(isOverdue("2026-10-20T14:00:00", "2026-10-20T13:00:00")).toBe(false)
  })
  it("daysBetween", () => {
    expect(daysBetween("2026-11-01T00:00:00", "2026-10-20T00:00:00")).toBe(12)
    expect(daysBetween("2026-10-20T00:00:00", "2026-10-21T23:00:00")).toBe(-1)
  })
})
