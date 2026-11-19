import { getData } from "@/lib/data"
import type { Session } from "@/lib/session"
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
 * The "From roster" gaps (D12) of this mock page. Location Rosters is the API's now (B8), and this FE-only incident and cover model stays on its own seed until B11 (R8-15): it no longer
 * reads the roster seed (public/data/rosters is read only by the API's demo seed script), so the derivation is fed an empty list and gives no gaps. The B11 cover API brings them back from the
 * API's open shifts. Signature kept so the hidden pages are untouched.
 */
export async function getDerivedGaps(session: Session, userName: string, today: string): Promise<RosterGap[]> {
  return gapsFromOpenShifts([], [], [], [], today)
}
