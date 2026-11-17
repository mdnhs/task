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
