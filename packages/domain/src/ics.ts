import { shiftEnd, type RosterShift } from "./rosters"
import { wallToEpoch } from "./shifts"

// iCalendar export of roster shifts (FR-RS-33, 40, RFC 5545). Pure. Times are written in UTC (no VTIMEZONE: every calendar app converts), computed from the shift's own zone with the DST-correct
// `wallToEpoch`, or taken from stored instants when the caller has them (the API: `startAt` / `endAt`), so a shift across a clock change lands on the right instant. An overnight shift ends
// the next day. THE one builder (R8-16): the API serves it as `GET /v1/roster/mine.ics`; `lib/ics.ts` (web) re-exports it.

export type IcsShift = Pick<RosterShift, "id" | "date" | "start" | "end"> & {
  title?: string
  role?: string
  location?: string
  description?: string
  /** Epoch ms of the start and end when the caller already has the instants (the API's stored `start_at` / `end_at`): used as they are, no zone needed. */
  startAt?: number
  endAt?: number
}

/** Options of `buildIcs`. `tz` is the zone of shifts that carry no instants; `now` (epoch ms) only sets DTSTAMP; `uidHost` is what follows the `@` of every UID. */
export type IcsOptions = { tz: string; now: number; uidHost?: string; calendarName?: string }

const pad = (n: number) => String(n).padStart(2, "0")

function utc(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Escapes a TEXT value: backslash, semicolon, comma and newlines (RFC 5545 3.3.11). A bare CR or LF can never reach the output as a line break (header injection), and no other control character survives. */
export function icsEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
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

/** One VEVENT per shift, UID `<shift id>@<uidHost>` (stable per shift), lines end in CRLF. */
export function buildIcs(shifts: IcsShift[], o: IcsOptions): string {
  const host = o.uidHost ?? "roster"
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Roster//Shifts//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
  if (o.calendarName) lines.push(`X-WR-CALNAME:${icsEscape(o.calendarName)}`)
  for (const s of shifts) {
    const start = s.startAt ?? wallToEpoch(`${s.date}T${s.start}`, o.tz)
    const end = s.endAt ?? wallToEpoch(shiftEnd(s, o.tz), o.tz)
    lines.push(
      "BEGIN:VEVENT",
      `UID:${icsEscape(s.id)}@${icsEscape(host)}`,
      `DTSTAMP:${utc(o.now)}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(end)}`,
      `SUMMARY:${icsEscape(s.title ?? s.role ?? "Shift")}`,
    )
    if (s.location) lines.push(`LOCATION:${icsEscape(s.location)}`)
    if (s.description) lines.push(`DESCRIPTION:${icsEscape(s.description)}`)
    lines.push("END:VEVENT")
  }
  lines.push("END:VCALENDAR")
  return lines.map(icsFold).join("\r\n") + "\r\n"
}

/** The web's long-standing entry point (UID host `roster`): `lib/ics.ts` keeps exporting it. Byte for byte what the old builder wrote for the same shifts (ics.test.ts parity). */
export const toIcs = (shifts: IcsShift[], tz: string, now: number = Date.now()): string => buildIcs(shifts, { tz, now })
