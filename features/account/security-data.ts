// The Security tab's data from GET /v1/me/sessions (B6 I21): a device label and last activity per session, never a token, an IP or a location
// (there is no GeoIP). The activity list is the last five sign-ins. Pure.
import type { ActivityItem, DeviceSession, SecurityData } from "./types"

export type SessionItem = { id: string; label: string; createdAt: string; lastSeenAt: string; current: boolean }

/** The instant as the tenant's wall clock "YYYY-MM-DDTHH:mm:ss" (what `<When>` expects); "" for an invalid instant. */
export function wallTime(iso: string, timezone: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

export const kindOf = (label: string): DeviceSession["kind"] => (/\b(iOS|Android)\b/.test(label) ? "phone" : "laptop")

export function activityFromSessions(items: SessionItem[], timezone: string): ActivityItem[] {
  return [...items]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5)
    .map((s) => ({ id: `a-${s.id}`, text: `Signed in from ${s.label}`, at: wallTime(s.createdAt, timezone) }))
}

export function securityFromSessions(items: SessionItem[], o: { timezone: string; twoFactorEnabled: boolean }): SecurityData {
  return {
    mfa: o.twoFactorEnabled,
    resetLinkMinutes: 60, // the API's reset token lifetime
    sessions: items.map((s) => ({ id: s.id, device: s.label, kind: kindOf(s.label), lastActive: wallTime(s.lastSeenAt, o.timezone), current: s.current })),
    activity: activityFromSessions(items, o.timezone),
  }
}
