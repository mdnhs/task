import { describe, expect, it } from "vitest"
import { daysBetween, formatDate, formatDue, formatTime, isOverdue, nowInTz } from "./dates"

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

describe("nowInTz", () => {
  it("renders the instant in the given timezone on the org date", () => {
    const now = new Date("2026-10-20T16:52:07Z") // BST (UTC+1) in London, UTC+9 in Tokyo
    expect(nowInTz("2026-10-20T09:00:00", "Europe/London", now)).toBe("2026-10-20T17:52:07")
    expect(nowInTz("2026-10-20", "Asia/Tokyo", now)).toBe("2026-10-20T01:52:07")
  })
  it("uses a 24-hour clock around midnight", () => {
    expect(nowInTz("2026-10-20", "Europe/London", new Date("2026-10-20T23:00:00Z"))).toBe("2026-10-20T00:00:00")
  })
})
