import { LocationsView, loadLocations, loadRosterPeople } from "@/features/rosters"
import { AccessRestricted, apiFailureView, mockGate } from "@/features/shell"
import { ApiError } from "@/lib/api/problem"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { requireMfaOk } from "@/lib/session"

// Locations admin on the API (FR-RS-01, 30, 34; B8 Task 22): office roles only (D4). The API says the level (`access.level` of the caller's draft-week access) and cuts the locations and the
// people to the caller's sites; a supervisor or staff member gets "no access" here and no location data.
export default async function Page() {
  const off = mockGate("Location Rosters")
  if (off) return off
  const [session, org] = await Promise.all([requireMfaOk(), getOrg()])
  if (!can(session.role, "roster")) return <AccessRestricted moduleLabel="Locations" />
  const loaded = await Promise.all([loadLocations(true), loadRosterPeople()]).then(([locations, people]) => ({ ok: true as const, locations, people })).catch((e: unknown) => ({ ok: false as const, e }))
  if (!loaded.ok) {
    const v = apiFailureView(loaded.e, "Locations")
    if (v) return v
    if (loaded.e instanceof ApiError && (loaded.e.status === 403 || loaded.e.status === 404)) return <AccessRestricted moduleLabel="Locations" />
    throw loaded.e
  }
  if (loaded.people.access.level !== "office") return <AccessRestricted moduleLabel="Locations" />
  return <LocationsView locations={loaded.locations} people={loaded.people.members} truncated={loaded.people.truncated} today={org.today.slice(0, 10)} />
}
