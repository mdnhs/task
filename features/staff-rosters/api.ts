import { getData } from "@/lib/data"
import { hasProductModule } from "@/lib/entitlements"
import { getPeople } from "@/lib/people"
import { can } from "@/lib/permissions"
import { rosterAccess, type LocationGrant, type OfficeLimit } from "@/lib/roster-access"
import type { Location, RosterShift, RosterWeek, ShiftTemplate } from "@/lib/rosters"
import type { Session } from "@/lib/session"
import { todayUserId } from "@/lib/today-data"
import { gapsFromOpenShifts } from "./logic"
import type { Incident, RosterGap, StaffMember } from "./types"

function strip<T extends { contact?: string; notes?: string }>(rows: T[]): T[] {
  return rows.map((r) => {
    const copy = { ...r }
    delete copy.contact
    delete copy.notes
    return copy
  })
}

// `sensitive` = the role has staff write access (FR-STAFF-03). Without it, contact details and notes are dropped here,
// on the server, so they never reach the client bundle or the HTML.
export async function getRosters(sensitive: boolean, derived: RosterGap[] = []) {
  const [{ incidents }, { gaps: stored }, { staff }] = await Promise.all([
    getData<{ incidents: Incident[] }>("staff-rosters/incidents.json"),
    getData<{ gaps: RosterGap[] }>("staff-rosters/roster-gaps.json"),
    getData<{ staff: (StaffMember & { contact?: string })[] }>("staff-rosters/staff.json"),
  ])
  const gaps = [...stored, ...derived.filter((d) => !stored.some((g) => g.id === d.id))]
  return { incidents: sensitive ? incidents : strip(incidents), gaps: sensitive ? gaps : strip(gaps), staff: strip(staff) as StaffMember[] }
}

/**
 * Open shifts of published roster weeks as roster gaps (D12), when the tenant has Location Rosters (M1A) and the role has the Roster module.
 * Cut to the locations the role may open (D4), so a supervisor never sees another location's open shifts. Pass the result to getRosters().
 */
export async function getDerivedGaps(session: Session, userName: string, today: string): Promise<RosterGap[]> {
  if (!hasProductModule(session.entitlements, "M1A") || !can(session.role, "roster")) return []
  const [locs, { grants, limits }, people] = await Promise.all([
    getData<{ locations: Location[] }>("rosters/locations.json"),
    getData<{ grants: LocationGrant[]; limits: OfficeLimit[] }>("rosters/access.json"),
    getPeople(),
  ])
  const access = rosterAccess(session.role, todayUserId(session, people, userName), grants, limits, locs.locations.map((l) => l.id))
  if (access.scope === "none" || access.scope === "own") return []
  const ids = new Set(access.locationIds ?? [])
  const [{ weeks }, { shifts }, { templates }] = await Promise.all([
    getData<{ weeks: RosterWeek[] }>("rosters/weeks.json"),
    getData<{ shifts: RosterShift[] }>("rosters/shifts.json"),
    getData<{ templates: ShiftTemplate[] }>("rosters/templates.json"),
  ])
  const locations = locs.locations.filter((l) => ids.has(l.id))
  return gapsFromOpenShifts(shifts.filter((s) => ids.has(s.locationId)), weeks.filter((w) => ids.has(w.locationId)), templates.filter((t) => ids.has(t.locationId)), locations, today)
}
