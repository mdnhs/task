import { describe, expect, it } from "vitest"
import { buildIcs, icsEscape, icsFold, toIcs, type IcsShift } from "./ics"
import { shiftEnd, type RosterShift } from "./rosters"
import { wallToEpoch } from "./shifts"

// B8 Task 14 (R8-16): ONE iCalendar builder in the domain. The web's `lib/ics.ts` re-exports it, the API serves it. The parity tests pin the bytes of the builder it replaced.

// ---- the frozen copy of the old `lib/ics.ts` (verbatim apart from the names), the reference of the parity tests ----

// iCalendar export of roster shifts (FR-RS-33, RFC 5545). Pure. Times are written in UTC, computed from the tenant zone with the
// DST-correct `wallToEpoch`, so a shift across a clock change lands on the right instant. An overnight shift ends the next day.

type LegacyShift = Pick<RosterShift, "id" | "date" | "start" | "end"> & { title?: string; role?: string; location?: string; description?: string }

const pad = (n: number) => String(n).padStart(2, "0")

function utc(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Escapes a TEXT value: backslash, semicolon, comma and newlines (RFC 5545 3.3.11). */
function legacyEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n")
}

/** Folds a content line at 75 octets (continuation lines start with one space), never splitting a character. */
function legacyFold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ""
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > limit) {
      out.push(cur)
      cur = ""
      bytes = 0
      limit = 74
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join("\r\n ")
}

/** One VEVENT per shift, UID stable per shift id, lines end in CRLF. `now` (epoch ms) only sets DTSTAMP. */
export function legacyToIcs(shifts: LegacyShift[], tz: string, now: number = Date.now()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Roster//Shifts//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
  for (const s of shifts) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${legacyEscape(s.id)}@roster`,
      `DTSTAMP:${utc(now)}`,
      `DTSTART:${utc(wallToEpoch(`${s.date}T${s.start}`, tz))}`,
      `DTEND:${utc(wallToEpoch(shiftEnd(s, tz), tz))}`,
      `SUMMARY:${legacyEscape(s.title ?? s.role ?? "Shift")}`,
    )
    if (s.location) lines.push(`LOCATION:${legacyEscape(s.location)}`)
    if (s.description) lines.push(`DESCRIPTION:${legacyEscape(s.description)}`)
    lines.push("END:VEVENT")
  }
  lines.push("END:VCALENDAR")
  return lines.map(legacyFold).join("\r\n") + "\r\n"
}

const TZ = "Europe/London"
const DUBLIN = "Europe/Dublin"
const NOW = Date.UTC(2026, 9, 20, 9, 0, 0)
const day: IcsShift = { id: "rs-1", date: "2026-10-20", start: "09:00", end: "17:00", role: "Security Officer" }
const night: IcsShift = { id: "rs-2", date: "2026-10-24", start: "22:00", end: "06:00", role: "Door" }
const fixtures: [string, IcsShift[], string][] = [
  ["a day and a night shift", [day, night], TZ],
  ["the clock-change night", [{ id: "rs-3", date: "2026-10-25", start: "22:00", end: "06:00" }], TZ],
  ["text that needs escaping", [{ ...day, title: "Door, front; bar", location: "Line1\nLine2; Hall, Level \\ 2", description: "a\r\nb" }], TZ],
  ["a line that must fold, with multi-byte characters", [{ ...day, description: "x".repeat(200) + "é€😀".repeat(30) }], DUBLIN],
  ["the spring gap", [{ id: "rs-4", date: "2027-03-28", start: "01:30", end: "09:30" }], DUBLIN],
  ["nothing", [], TZ],
]

describe("parity with the builder it replaced", () => {
  for (const [name, shifts, tz] of fixtures) {
    it(`${name}: same bytes as the old lib/ics.ts`, () => {
      expect(toIcs(shifts, tz, NOW)).toBe(legacyToIcs(shifts, tz, NOW))
      expect(buildIcs(shifts, { tz, now: NOW })).toBe(legacyToIcs(shifts, tz, NOW))
    })
  }
  it("escape and fold are the old functions", () => {
    for (const v of ["a,b;c\\d\ne", "plain", "", "x\r\ny\rz"]) expect(icsEscape(v)).toBe(legacyEscape(v))
    for (const v of ["short", "x".repeat(75), "x".repeat(76), "é".repeat(60), "x".repeat(300)]) expect(icsFold(v)).toBe(legacyFold(v))
  })
})

describe("buildIcs (B8 T14)", () => {
  it("SEQUENCE is the shift version when given (a retimed shift updates the calendar entry), absent otherwise (legacy bytes), and DTSTAMP is the same for every event of one export", () => {
    const a = buildIcs([{ ...day, version: 3 }, { ...day, id: "rs-2", version: 1 }], { tz: TZ, now: NOW })
    expect(a).toContain("SEQUENCE:3\r\n")
    expect(a).toContain("SEQUENCE:1\r\n")
    expect(new Set(a.match(/DTSTAMP:\S+/g)).size).toBe(1)
    expect(buildIcs([day], { tz: TZ, now: NOW })).not.toContain("SEQUENCE")
  })
  it("uses the UID host, stored instants when given, and a calendar name when asked", () => {
    const s = buildIcs([{ ...day, startAt: Date.UTC(2026, 9, 20, 8, 0), endAt: Date.UTC(2026, 9, 20, 16, 0) }], { tz: TZ, now: NOW, uidHost: "api.example.com", calendarName: "My roster, Nov" })
    expect(s).toContain("UID:rs-1@api.example.com\r\n")
    expect(s).toContain("DTSTART:20261020T080000Z\r\n")
    expect(s).toContain("DTEND:20261020T160000Z\r\n")
    expect(s).toContain("X-WR-CALNAME:My roster\\, Nov\r\n")
  })
  it("the instants of a shift without them are wallToEpoch in the shift's zone: the 24 Oct 2026 night is 9 real hours, the next Saturday 8", () => {
    const [a, b] = [buildIcs([night], { tz: DUBLIN, now: NOW }), buildIcs([{ ...night, id: "rs-9", date: "2026-10-31" }], { tz: DUBLIN, now: NOW })]
    expect(a).toContain("DTSTART:20261024T210000Z")
    expect(a).toContain("DTEND:20261025T060000Z")
    expect(b).toContain("DTSTART:20261031T220000Z")
    expect(b).toContain("DTEND:20261101T060000Z")
    expect(wallToEpoch(shiftEnd(night, DUBLIN), DUBLIN) - wallToEpoch("2026-10-24T22:00", DUBLIN)).toBe(9 * 3_600_000)
  })
  it("never lets a CR, LF or other control character of a value break out of its line (no header or property injection)", () => {
    const evil = "Door\r\nATTENDEE:mailto:evil@example.com\rBEGIN:VALARM\n\u0007\u0000end"
    const s = buildIcs([{ ...day, title: evil, location: evil, description: evil }], { tz: TZ, now: NOW })
    const lines = s.split("\r\n")
    expect(lines.filter((l) => /^(ATTENDEE|BEGIN:VALARM)/.test(l))).toEqual([])
    expect(s.replace(/\r\n/g, "")).not.toMatch(/[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/)
    expect(s.match(/BEGIN:VEVENT/g)).toHaveLength(1)
  })
  it("every line is at most 75 octets and a folded line starts with one space", () => {
    const s = buildIcs([{ ...day, title: "é".repeat(100), location: "x".repeat(300) }], { tz: TZ, now: NOW })
    for (const line of s.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(s).toMatch(/\r\n [^ ]/)
  })
  it("a shift is a RosterShift-compatible input (the domain type is reused, not copied)", () => {
    const r: RosterShift = { id: "x", weekId: "w", locationId: "l", date: "2026-10-20", personId: null, templateId: "t", role: "Guard", start: "08:00", end: "16:00", unpaidBreakMin: 0, confirmedAt: null }
    expect(buildIcs([r], { tz: TZ, now: NOW })).toContain("SUMMARY:Guard")
  })
})
