import { getData } from "@/lib/data"
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
export async function getRosters(sensitive: boolean) {
  const [{ incidents }, { gaps }, { staff }] = await Promise.all([
    getData<{ incidents: Incident[] }>("staff-rosters/incidents.json"),
    getData<{ gaps: RosterGap[] }>("staff-rosters/roster-gaps.json"),
    getData<{ staff: (StaffMember & { contact?: string })[] }>("staff-rosters/staff.json"),
  ])
  return { incidents: sensitive ? incidents : strip(incidents), gaps: sensitive ? gaps : strip(gaps), staff: strip(staff) as StaffMember[] }
}
