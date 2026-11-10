import { wallToEpoch } from "./shifts"
import { shiftEnd, type RosterShift } from "./rosters"

// iCalendar export of roster shifts (FR-RS-33, RFC 5545). Pure. Times are written in UTC, computed from the tenant zone with the
// DST-correct `wallToEpoch`, so a shift across a clock change lands on the right instant. An overnight shift ends the next day.

export type IcsShift = Pick<RosterShift, "id" | "date" | "start" | "end"> & { title?: string; role?: string; location?: string; description?: string }

const pad = (n: number) => String(n).padStart(2, "0")

function utc(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Escapes a TEXT value: backslash, semicolon, comma and newlines (RFC 5545 3.3.11). */
export function icsEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n")
}

/** Folds a content line at 75 octets (continuation lines start with one space), never splitting a character. */
export function icsFold(line: string): string {
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
export function toIcs(shifts: IcsShift[], tz: string, now: number = Date.now()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Roster//Shifts//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
  for (const s of shifts) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(s.id)}@roster`,
      `DTSTAMP:${utc(now)}`,
      `DTSTART:${utc(wallToEpoch(`${s.date}T${s.start}`, tz))}`,
      `DTEND:${utc(wallToEpoch(shiftEnd(s, tz), tz))}`,
      `SUMMARY:${icsEscape(s.title ?? s.role ?? "Shift")}`,
    )
    if (s.location) lines.push(`LOCATION:${icsEscape(s.location)}`)
    if (s.description) lines.push(`DESCRIPTION:${icsEscape(s.description)}`)
    lines.push("END:VEVENT")
  }
  lines.push("END:VCALENDAR")
  return lines.map(icsFold).join("\r\n") + "\r\n"
}
