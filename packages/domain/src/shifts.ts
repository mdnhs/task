// Shift model (SRS FR-M1-20 shift patterns + assignments, FR-M1-21 reporting on/off, FR-M0-07 teams and reporting lines).
// Pure and server-safe (no React, no stores): the /shifts page and the end-of-shift report (Phase 1 step 2) both import it.
// Client store: hooks/use-shifts.ts. Server loader: lib/shifts-data.ts.
//
// Time model
// - Dates are "YYYY-MM-DD" strings, times "HH:MM" (24h), wall-clock instants "YYYY-MM-DDTHH:MM" (optionally ":SS").
// - All wall-clock strings returned here are in the TENANT time zone (org.timezone), never the browser's.
// - A pattern's start/end are read in the pattern's own `timeZone` (default: the tenant's) and converted to tenant time.
// - Lengths, "is it now in the shift" and "report due" use real elapsed time (epoch ms via Intl), so a night shift on a
//   DST change night is 7 or 9 real hours, and "60 minutes after shift end" is 60 real minutes.
// - Day stepping (addDays, weekdayOf) uses UTC day numbers on date strings, like features/tasks/recurrence.ts: no DST, no browser zone.
// - DST edge cases: a wall time that does not exist (spring-forward gap) moves forward by the gap (01:30 → 02:30);
//   an ambiguous wall time (fall-back hour) resolves to the EARLIER of its two instants.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6 // 0 = Sunday ... 6 = Saturday

export type ShiftPattern = {
  id: string
  name: string
  /** Team name. Departments map to teams for now (SRS Appendix A.5), so this is one of org.departments. */
  team: string
  /** "HH:MM" 24h, wall clock in `timeZone`. */
  start: string
  /** "HH:MM". When end <= start the shift ends the NEXT day (night shift); end === start is a 24h shift. */
  end: string
  /** Weekdays the shift STARTS on (a Mon 22:00–06:00 shift is a Monday shift). */
  days: Weekday[]
  /** IANA zone; omitted = the tenant time zone. */
  timeZone?: string
}

/** A person works a pattern from `from` (inclusive) until `until` (inclusive, open-ended when omitted). Dates are shift start dates. */
export type ShiftAssignment = { personId: string; patternId: string; from: string; until?: string }

/**
 * End-of-shift reporting settings (FR-M1-21, Q5, Q7). Effective reporting for a person on a team = their override when set,
 * otherwise the team default (missing team default = off). `dueAfterMinutes` is the tenant setting for when a report is due.
 */
export type ReportingSettings = {
  dueAfterMinutes: number
  teamDefaults: Record<string, boolean>
  overrides: Record<string, boolean>
}

/** Reporting line (FR-M0-07): a member belongs to one or more teams (first = primary team) and has one primary manager. */
export type TeamMember = { personId: string; teams: string[]; managerId: string | null }

/** One concrete occurrence of a pattern, in tenant wall-clock time. */
export type ShiftWindow = {
  patternId: string
  /** Shift start date (tenant time); the shift "belongs" to this date. */
  date: string
  /** "YYYY-MM-DDTHH:MM", tenant time. */
  start: string
  /** "YYYY-MM-DDTHH:MM", tenant time; a later date when the shift crosses midnight. */
  end: string
  /** The tenant zone the start/end strings are in. */
  timeZone: string
  /** End falls on a later tenant date than start. */
  endsNextDay: boolean
  /** Real elapsed minutes (DST-aware). */
  minutes: number
}

export type ShiftOccurrence = { personId: string; pattern: ShiftPattern; window: ShiftWindow }

export type EffectiveReporting = { on: boolean; source: "override" | "team"; team: string | null }

/**
 * Report timing for one shift (step 2 maps this onto FR-M1-28 statuses):
 * upcoming = not started, in_shift = running, open = ended and before the due time, missing = due time passed with no report,
 * on_time / late = submitted before / after the due time.
 */
export type ReportTiming = "upcoming" | "in_shift" | "open" | "missing" | "on_time" | "late"

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

// ---------- dates and times (strings, no browser zone) ----------

const DAY_MS = 86_400_000
const MIN_MS = 60_000
const pad = (n: number) => String(n).padStart(2, "0")
const dayNum = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split("-").map((n) => parseInt(n, 10))
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}
const dateOfNum = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10)

/** True for a valid 24h "HH:MM". */
export function isHm(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}

/** Minutes since midnight of "HH:MM". */
export function hmMinutes(v: string): number {
  const [h, m] = v.split(":").map((n) => parseInt(n, 10))
  return h * 60 + m
}

/** Day of week of a date (or wall-clock string): 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (date: string) => ((((dayNum(date) + 4) % 7) + 7) % 7) as Weekday
export const addDays = (date: string, n: number) => dateOfNum(dayNum(date) + n)
/** Monday (or `firstDay`) of the week containing `date`. */
export const weekStart = (date: string, firstDay: Weekday = 1) => addDays(date, -((weekdayOf(date) - firstDay + 7) % 7))
/** The 7 dates of the week starting at `start`. */
export const weekDates = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i))

// ---------- time zones (Intl, cached formatters) ----------

const fmts = new Map<string, Intl.DateTimeFormat>()
function fmt(tz: string) {
  let f = fmts.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    fmts.set(tz, f)
  }
  return f
}

/** True when `tz` is an IANA zone this runtime knows. */
export function isTimeZone(tz: string): boolean {
  try {
    fmt(tz)
    return true
  } catch {
    return false
  }
}

function zoneParts(ms: number, tz: string) {
  const p = Object.fromEntries(fmt(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second }
}

/** Offset of `tz` from UTC at instant `ms`, in ms (Europe/London summer = +3_600_000). */
function offsetAt(ms: number, tz: string): number {
  const { y, mo, d, h, mi, s } = zoneParts(ms, tz)
  return Date.UTC(y, mo - 1, d, h, mi, s) - Math.floor(ms / 1000) * 1000
}

function wallUtc(wall: string): number {
  const [y, mo, d, h = 0, mi = 0, s = 0] = wall.split(/[-T:]/).map((n) => parseInt(n, 10))
  return Date.UTC(y, mo - 1, d, h, mi, s)
}

/** Epoch ms of a wall-clock string in `tz`. Gap times move forward; ambiguous times take the earlier instant (see header). */
export function wallToEpoch(wall: string, tz: string): number {
  const naive = wallUtc(wall)
  const before = offsetAt(naive - DAY_MS, tz)
  const after = offsetAt(naive + DAY_MS, tz)
  const fits = [naive - before, naive - after].filter((t) => offsetAt(t, tz) === naive - t)
  if (fits.length) return Math.min(...fits)
  return naive - before // gap: read with the pre-transition offset, which lands after the gap
}

/** "YYYY-MM-DDTHH:MM" wall clock in `tz` for an instant. */
export function epochToWall(ms: number, tz: string): string {
  const { y, mo, d, h, mi } = zoneParts(ms, tz)
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`
}

/** Adds real minutes to a wall-clock string in `tz` (DST-aware). */
export function addMinutes(wall: string, minutes: number, tz: string): string {
  return epochToWall(wallToEpoch(wall, tz) + minutes * MIN_MS, tz)
}

/** Real minutes from wall `a` to wall `b`, both in `tz`. */
export function minutesBetween(a: string, b: string, tz: string): number {
  return Math.round((wallToEpoch(b, tz) - wallToEpoch(a, tz)) / MIN_MS)
}

// ---------- patterns and windows ----------

/** The pattern ends on the day after it starts (end <= start, read in its own zone). */
export function crossesMidnight(p: Pick<ShiftPattern, "start" | "end">): boolean {
  return hmMinutes(p.end) <= hmMinutes(p.start)
}

/** Whether the pattern starts on this date's weekday. */
export function runsOn(p: Pick<ShiftPattern, "days">, date: string): boolean {
  return p.days.includes(weekdayOf(date))
}

/**
 * The occurrence of `pattern` that starts on `date` (a date in the pattern's own zone, which is the tenant zone unless the
 * pattern overrides it), with start/end in tenant wall-clock time. Does not check `days`; use `runsOn` / `shiftsOn` for that.
 */
export function shiftWindow(pattern: ShiftPattern, date: string, tenantTz: string): ShiftWindow {
  const tz = pattern.timeZone || tenantTz
  const d = date.slice(0, 10)
  const startMs = wallToEpoch(`${d}T${pattern.start}`, tz)
  const endMs = wallToEpoch(`${crossesMidnight(pattern) ? addDays(d, 1) : d}T${pattern.end}`, tz)
  const start = epochToWall(startMs, tenantTz)
  const end = epochToWall(endMs, tenantTz)
  return {
    patternId: pattern.id,
    date: start.slice(0, 10),
    start,
    end,
    timeZone: tenantTz,
    endsNextDay: end.slice(0, 10) !== start.slice(0, 10),
    minutes: Math.round((endMs - startMs) / MIN_MS),
  }
}

/** Assignment covers the shift starting on `date` (from/until inclusive). */
export function isAssignedOn(a: ShiftAssignment, date: string): boolean {
  const d = date.slice(0, 10)
  return a.from <= d && (!a.until || d <= a.until)
}

/** Stable id of one person's shift, e.g. "p-marcus:pat-sec-night:2026-10-20". Step 2 keys reports by it. */
export function shiftKey(personId: string, w: Pick<ShiftWindow, "patternId" | "date">): string {
  return `${personId}:${w.patternId}:${w.date}`
}

/**
 * Every assigned shift that STARTS on `date` (tenant date), sorted by start then person. A night shift from the evening
 * before is not included; use `currentShift` / `shiftsOverlapping` for "who is working now".
 */
export function shiftsOn(date: string, patterns: ShiftPattern[], assignments: ShiftAssignment[], tenantTz: string): ShiftOccurrence[] {
  const byId = new Map(patterns.map((p) => [p.id, p]))
  const out: ShiftOccurrence[] = []
  for (const a of assignments) {
    const p = byId.get(a.patternId)
    if (!p || !runsOn(p, date) || !isAssignedOn(a, date)) continue
    out.push({ personId: a.personId, pattern: p, window: shiftWindow(p, date, tenantTz) })
  }
  return out.sort((x, y) => x.window.start.localeCompare(y.window.start) || x.personId.localeCompare(y.personId))
}

/** Shifts of one person starting between `from` and `to` (dates, inclusive), in start order. */
export function shiftsFor(personId: string, from: string, to: string, patterns: ShiftPattern[], assignments: ShiftAssignment[], tenantTz: string): ShiftOccurrence[] {
  const mine = assignments.filter((a) => a.personId === personId)
  const out: ShiftOccurrence[] = []
  for (let n = dayNum(from); n <= dayNum(to); n++) out.push(...shiftsOn(dateOfNum(n), patterns, mine, tenantTz))
  return out
}

/** The shift `personId` is in at tenant wall time `now` (start inclusive, end exclusive), or null. Checks yesterday's night shifts too. */
export function currentShift(personId: string, now: string, patterns: ShiftPattern[], assignments: ShiftAssignment[], tenantTz: string): ShiftOccurrence | null {
  const t = wallToEpoch(now, tenantTz)
  const d = now.slice(0, 10)
  return (
    shiftsFor(personId, addDays(d, -1), d, patterns, assignments, tenantTz).find(
      (o) => wallToEpoch(o.window.start, tenantTz) <= t && t < wallToEpoch(o.window.end, tenantTz),
    ) ?? null
  )
}

/** The most recent shift of `personId` that has ended by `now`, looking back `lookbackDays` days; null when none. */
export function lastEndedShift(personId: string, now: string, patterns: ShiftPattern[], assignments: ShiftAssignment[], tenantTz: string, lookbackDays = 7): ShiftOccurrence | null {
  const t = wallToEpoch(now, tenantTz)
  const d = now.slice(0, 10)
  const ended = shiftsFor(personId, addDays(d, -lookbackDays), d, patterns, assignments, tenantTz).filter((o) => wallToEpoch(o.window.end, tenantTz) <= t)
  return ended.at(-1) ?? null
}

// ---------- reporting (FR-M1-21, FR-M1-22 hook, Q5, Q7) ----------

/** When the end-of-shift report is due: `dueAfterMinutes` real minutes after the shift ends, tenant wall time. */
export function reportDue(window: ShiftWindow, dueAfterMinutes: number): string {
  return addMinutes(window.end, dueAfterMinutes, window.timeZone)
}

/**
 * Effective reporting for a person (Q5: per person, with a team default). `team` = the team to read the default from:
 * pass the shift pattern's team for a concrete shift; omitted = the person's primary team (first in `members`).
 */
export function reportsFor(personId: string, members: TeamMember[], settings: ReportingSettings, team?: string): EffectiveReporting {
  const t = team ?? primaryTeam(personId, members)
  const o = settings.overrides[personId]
  if (o !== undefined) return { on: o, source: "override", team: t }
  return { on: t ? settings.teamDefaults[t] === true : false, source: "team", team: t }
}

/** Timing of one shift's report at `now` (tenant wall time); `submittedAt` = tenant wall time of submission, if any. */
export function reportTiming(window: ShiftWindow, dueAfterMinutes: number, now: string, submittedAt?: string | null): ReportTiming {
  const tz = window.timeZone
  const due = wallToEpoch(reportDue(window, dueAfterMinutes), tz)
  if (submittedAt) return wallToEpoch(submittedAt, tz) <= due ? "on_time" : "late"
  const t = wallToEpoch(now, tz)
  if (t < wallToEpoch(window.start, tz)) return "upcoming"
  if (t < wallToEpoch(window.end, tz)) return "in_shift"
  return t <= due ? "open" : "missing"
}

/**
 * FR-M1-22 hook for step 2: the shift a member should be prompted to report on at `now`, i.e. their last ended shift when
 * reporting is on for that shift's team and no report was submitted for it (`submitted` holds shiftKey()s). Null otherwise.
 */
export function reportPromptFor(
  personId: string,
  now: string,
  data: { patterns: ShiftPattern[]; assignments: ShiftAssignment[]; members: TeamMember[]; reporting: ReportingSettings },
  tenantTz: string,
  submitted: ReadonlySet<string> = new Set(),
): { shift: ShiftOccurrence; key: string; due: string; timing: ReportTiming } | null {
  const shift = lastEndedShift(personId, now, data.patterns, data.assignments, tenantTz)
  if (!shift || !reportsFor(personId, data.members, data.reporting, shift.pattern.team).on) return null
  const key = shiftKey(personId, shift.window)
  if (submitted.has(key)) return null
  return { shift, key, due: reportDue(shift.window, data.reporting.dueAfterMinutes), timing: reportTiming(shift.window, data.reporting.dueAfterMinutes, now) }
}

// ---------- teams and reporting lines (FR-M0-07) ----------

export function memberOf(personId: string, members: TeamMember[]): TeamMember | undefined {
  return members.find((m) => m.personId === personId)
}

/** First team of the member, or null when they have no line. */
export function primaryTeam(personId: string, members: TeamMember[]): string | null {
  return memberOf(personId, members)?.teams[0] ?? null
}

/** Primary manager's person id, or null. */
export function managerOf(personId: string, members: TeamMember[]): string | null {
  return memberOf(personId, members)?.managerId ?? null
}

/** Person ids whose primary manager is `managerId`. */
export function directReports(managerId: string, members: TeamMember[]): string[] {
  return members.filter((m) => m.managerId === managerId).map((m) => m.personId)
}

/** Member is on `team` (any of their teams; "all" matches everyone). */
export function onTeam(personId: string, members: TeamMember[], team: string): boolean {
  return team === "all" || !!memberOf(personId, members)?.teams.includes(team)
}

// ---------- labels ----------

/** "22:00–07:00 +1" (the +1 marks a next-day end), from the pattern's own clock. */
export function patternTimeLabel(p: Pick<ShiftPattern, "start" | "end">): string {
  return `${p.start}–${p.end}${crossesMidnight(p) ? " +1" : ""}`
}

/** "Mon–Fri", "Sun–Thu", "Every day", "Sat, Sun", "Mon, Wed, Fri" (Monday-first; runs of 3+ days may wrap the week). */
export function daysLabel(days: Weekday[]): string {
  const order: Weekday[] = [1, 2, 3, 4, 5, 6, 0]
  const set = order.filter((d) => days.includes(d))
  if (set.length === 7) return "Every day"
  if (!set.length) return "No days"
  if (set.length >= 3) {
    // A run starts on a day whose previous day is off; it is contiguous when the next set.length days are all on.
    const first = set.find((d) => !days.includes(((d + 6) % 7) as Weekday))
    if (first !== undefined && set.every((_, i) => days.includes(((first + i) % 7) as Weekday)))
      return `${WEEKDAY_SHORT[first]}–${WEEKDAY_SHORT[(first + set.length - 1) % 7]}`
  }
  return set.map((d) => WEEKDAY_SHORT[d]).join(", ")
}

/** Hours label for real minutes: "8h", "7h 30m". */
export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

// ---------- data bundle, payload scoping and edits (used by the /shifts page and hooks/use-shifts.ts) ----------

/** Everything the shift model needs, as the server loads it (lib/shifts-data.ts) and the client store holds it. */
export type ShiftState = {
  patterns: ShiftPattern[]
  assignments: ShiftAssignment[]
  members: TeamMember[]
  reporting: ReportingSettings
}

/**
 * Cuts the bundle down to one person's own shifts (read-only roles, FR-M0-07 privacy): their assignments, the patterns
 * they use, their own reporting line, their override, and the team defaults of their teams. No other person's data.
 */
export function ownShiftState(s: ShiftState, personId: string): ShiftState {
  const assignments = s.assignments.filter((a) => a.personId === personId)
  const ids = new Set(assignments.map((a) => a.patternId))
  const members = s.members.filter((m) => m.personId === personId)
  const teams = new Set(members.flatMap((m) => m.teams))
  const own = s.reporting.overrides[personId]
  return {
    patterns: s.patterns.filter((p) => ids.has(p.id)),
    assignments,
    members,
    reporting: {
      dueAfterMinutes: s.reporting.dueAfterMinutes,
      teamDefaults: Object.fromEntries(Object.entries(s.reporting.teamDefaults).filter(([t]) => teams.has(t))),
      overrides: own === undefined ? {} : { [personId]: own },
    },
  }
}

/** Adds or replaces a pattern (by id). */
export function upsertPattern(s: ShiftState, p: ShiftPattern): ShiftState {
  const has = s.patterns.some((x) => x.id === p.id)
  return { ...s, patterns: has ? s.patterns.map((x) => (x.id === p.id ? p : x)) : [...s.patterns, p] }
}

/** Removes a pattern and every assignment to it. */
export function deletePattern(s: ShiftState, id: string): ShiftState {
  return { ...s, patterns: s.patterns.filter((p) => p.id !== id), assignments: s.assignments.filter((a) => a.patternId !== id) }
}

/** Next free "pat-N" id. */
export function nextPatternId(patterns: ShiftPattern[]): string {
  const max = patterns.reduce((m, p) => Math.max(m, parseInt(p.id.replace(/\D/g, ""), 10) || 0), 0)
  return `pat-${max + 1}`
}

/** Active assignment of a person to a pattern on `date`. */
export function activeAssignment(s: Pick<ShiftState, "assignments">, personId: string, patternId: string, date: string): ShiftAssignment | undefined {
  return s.assignments.find((a) => a.personId === personId && a.patternId === patternId && isAssignedOn(a, date))
}

/** Assigns from `date` on (no-op when already assigned that day). */
export function assign(s: ShiftState, personId: string, patternId: string, date: string): ShiftState {
  if (activeAssignment(s, personId, patternId, date)) return s
  return { ...s, assignments: [...s.assignments, { personId, patternId, from: date.slice(0, 10) }] }
}

/**
 * Ends a person's assignments to a pattern from `date` on: ones starting on/after `date` are dropped, a running one gets
 * `until` = the day before. Earlier history stays, so past weeks still show the shifts that were worked.
 */
export function unassign(s: ShiftState, personId: string, patternId: string, date: string): ShiftState {
  const d = date.slice(0, 10)
  const prev = addDays(d, -1)
  const assignments = s.assignments.flatMap((a) => {
    if (a.personId !== personId || a.patternId !== patternId) return [a]
    if (a.from >= d) return []
    if (a.until && a.until < d) return [a]
    return [{ ...a, until: prev }]
  })
  return { ...s, assignments }
}

/** Team default for end-of-shift reporting. */
export function setTeamDefault(s: ShiftState, team: string, on: boolean): ShiftState {
  return { ...s, reporting: { ...s.reporting, teamDefaults: { ...s.reporting.teamDefaults, [team]: on } } }
}

/** Per-person override; `null` clears it so the person follows the team default again. */
export function setOverride(s: ShiftState, personId: string, on: boolean | null): ShiftState {
  const overrides = { ...s.reporting.overrides }
  if (on === null) delete overrides[personId]
  else overrides[personId] = on
  return { ...s, reporting: { ...s.reporting, overrides } }
}

/**
 * Sets a person's effective reporting from a toggle: when the wanted value equals what their team default gives, the
 * override is cleared (they follow the team again); otherwise an override is stored.
 */
export function toggleReporting(s: ShiftState, personId: string, on: boolean): ShiftState {
  const team = primaryTeam(personId, s.members)
  const byTeam = team ? s.reporting.teamDefaults[team] === true : false
  return setOverride(s, personId, on === byTeam ? null : on)
}
