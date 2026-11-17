// Tenant wall-clock helpers. Pure: the zone is always an argument (the tenant's own IANA name from /v1/me/tenant), never a default.

/** An instant as the tenant's local wall time, "YYYY-MM-DDTHH:mm:ss" (the format the UI's date helpers take). A zone Intl does not know is an error. */
export function wallInTz(at: Date | string, tz: string): string {
  const d = typeof at === "string" ? new Date(at) : at
  if (Number.isNaN(d.getTime())) throw new Error("wallInTz: not a date")
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

/** A readable name for the zone ("Ireland Time", "New Zealand Time"); the IANA name itself when Intl cannot give one. */
export function zoneLabel(tz: string, at: Date): string {
  try {
    const name = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "longGeneric" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value
    return name || tz
  } catch {
    return tz
  }
}

/**
 * The UTC instant of a wall-clock time in a zone ("YYYY-MM-DDTHH:mm:ss"). Two passes through the zone's offset, so a day with a DST change is right at both ends.
 * In the repeated hour of a fall-back the first instant wins; a time that does not exist (spring-forward gap) lands just after the gap.
 */
function instantOfWall(wall: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(wall)
  if (!m) throw new Error("instantOfWall: not a wall time")
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!)
  let t = asUtc
  for (let i = 0; i < 3; i++) {
    const seen = wallInTz(new Date(t), tz) // throws for an unknown zone
    const sm = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(seen)!
    const seenUtc = Date.UTC(+sm[1]!, +sm[2]! - 1, +sm[3]!, +sm[4]!, +sm[5]!, +sm[6]!)
    const diff = asUtc - seenUtc
    if (diff === 0) break
    t += diff
  }
  return new Date(t)
}

/** A tenant calendar day ("YYYY-MM-DD") as the UTC instants of its first and last millisecond. */
export function dayBoundsInTz(day: string, tz: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("dayBoundsInTz: not a day")
  const from = instantOfWall(`${day}T00:00:00`, tz)
  // the end: the instant just before the next local midnight (a 23 or 25 hour day is handled by the zone, not by +24 h)
  const next = new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + 1))
  const nextDay = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`
  return { from: from.toISOString(), to: new Date(instantOfWall(`${nextDay}T00:00:00`, tz).getTime() - 1).toISOString() }
}
