import { describe, expect, it } from "vitest"
import { icsEscape, toIcs, type IcsShift } from "./ics"

const TZ = "Europe/London"
const NOW = Date.UTC(2026, 9, 20, 9, 0, 0)
const day: IcsShift = { id: "rs-1", date: "2026-10-20", start: "09:00", end: "17:00", role: "Security Officer" }
const night: IcsShift = { id: "rs-2", date: "2026-10-24", start: "22:00", end: "06:00", role: "Door" }

describe("toIcs", () => {
  it("has one VEVENT per shift and CRLF line endings", () => {
    const s = toIcs([day, night], TZ, NOW)
    expect(s.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(s.match(/END:VEVENT/g)).toHaveLength(2)
    expect(s.endsWith("\r\n")).toBe(true)
    expect(s.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/)
    expect(s.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true)
  })
  it("writes UTC times from the tenant zone (BST in summer, GMT after the change)", () => {
    expect(toIcs([day], TZ, NOW)).toContain("DTSTART:20261020T080000Z") // BST until 25 Oct
    const winter = toIcs([{ ...day, date: "2026-11-02" }], TZ, NOW)
    expect(winter).toContain("DTSTART:20261102T090000Z")
  })
  it("an overnight shift ends the next day, across the clock change in real time", () => {
    const s = toIcs([{ ...night, date: "2026-10-24" }], TZ, NOW)
    expect(s).toContain("DTSTART:20261024T210000Z")
    expect(s).toContain("DTEND:20261025T060000Z")
    const change = toIcs([{ id: "rs-3", date: "2026-10-25", start: "22:00", end: "06:00" }], TZ, NOW)
    expect(change).toContain("DTSTART:20261025T220000Z")
    expect(change).toContain("DTEND:20261026T060000Z")
  })
  it("keeps the UID stable per shift id", () => {
    expect(toIcs([day], TZ, NOW)).toContain("UID:rs-1@roster")
    expect(toIcs([day], TZ, NOW + 5000)).toContain("UID:rs-1@roster")
  })
  it("escapes commas, semicolons, backslashes and newlines in text", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne")
    const s = toIcs([{ ...day, title: "Door, front; bar", location: "Line1\nLine2" }], TZ, NOW)
    expect(s).toContain("SUMMARY:Door\\, front\\; bar\r\n")
    expect(s).toContain("LOCATION:Line1\\nLine2\r\n")
  })
  it("escapes a semicolon with a real backslash in SUMMARY and LOCATION", () => {
    const s = toIcs([{ ...day, title: "Bar; Door", location: "Hall; Level 2" }], TZ, NOW)
    expect(s).toContain("SUMMARY:Bar\\; Door\r\n")
    expect(s).toContain("LOCATION:Hall\\; Level 2\r\n")
    expect(s).not.toMatch(/SUMMARY:Bar; /)
  })
  it("folds lines longer than 75 octets", () => {
    const s = toIcs([{ ...day, description: "x".repeat(200) }], TZ, NOW)
    for (const line of s.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  })
})
