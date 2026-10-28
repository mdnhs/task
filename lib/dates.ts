// ISO strings are treated as local wall-clock time. Components are parsed by
// hand (no Date locale APIs) so server and client render identically.
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function parts(iso: string) {
  const [y, mo, d, h = 0, mi = 0] = iso.split(/[-T:]/).map((n) => parseInt(n, 10))
  return { y, mo, d, h, mi }
}

/** Day number since epoch for the calendar date (timezone free). */
function dayNum(iso: string) {
  const { y, mo, d } = parts(iso)
  return Math.round(Date.UTC(y, mo - 1, d) / 86_400_000)
}

/** Minutes since epoch, wall-clock. */
function minNum(iso: string) {
  const { y, mo, d, h, mi } = parts(iso)
  return Date.UTC(y, mo - 1, d, h, mi) / 60_000
}

export function formatDate(iso: string): string {
  const { mo, d } = parts(iso)
  return `${DAYS[(dayNum(iso) + 4) % 7]} ${d} ${MONTHS[mo - 1]}`
}

export function formatTime(iso: string): string {
  const { h, mi } = parts(iso)
  return `${h % 12 || 12}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`
}

export function daysBetween(aIso: string, bIso: string): number {
  return dayNum(aIso) - dayNum(bIso)
}

export function formatDue(iso: string, today: string): string {
  const diff = daysBetween(iso, today)
  if (diff === 0) return `Today ${formatTime(iso)}`
  if (diff === 1) return `Tomorrow ${formatTime(iso)}`
  if (diff === -1) return `Yesterday ${formatTime(iso)}`
  return formatDate(iso)
}

export function isOverdue(dueIso: string, nowIso: string): boolean {
  return minNum(dueIso) < minNum(nowIso)
}

/**
 * The current wall-clock time in `tz` (IANA, e.g. org.timezone) on the org's "today" date, as a local ISO string
 * "YYYY-MM-DDTHH:mm:ss". The mock org date is fixed, so only the time of day comes from the real clock; never the
 * browser's own timezone. `now` is injectable for tests.
 */
export function nowInTz(today: string, tz: string, now: Date = new Date()): string {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
  const t = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]))
  return `${today.slice(0, 10)}T${t.hour}:${t.minute}:${t.second}`
}
