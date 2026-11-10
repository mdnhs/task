import { getLocationAdminData, rosterScopeKey, type LocationAdminData } from "@/features/rosters"
import { getUser } from "@/features/shell"
import { getData } from "@/lib/data"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { getPeople } from "@/lib/people"
import { rosterAccess, type LocationGrant, type OfficeLimit } from "@/lib/roster-access"
import { getSession } from "@/lib/session"
import { todayUserId } from "@/lib/today-data"

// Shared by the locations pages and their loading.tsx: only roles that edit published rosters (office level) may manage locations (D4);
// everyone else gets nothing, so a supervisor's request carries no location data.
export type LocationAdminGate = { data: LocationAdminData; scopeKey: string; me: string; today: string }

export async function locationAdminGate(): Promise<LocationAdminGate | null> {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "roster")) return null
  const [{ locations }, { grants, limits }, people] = await Promise.all([
    getData<{ locations: { id: string }[] }>("rosters/locations.json"),
    getData<{ grants: LocationGrant[]; limits: OfficeLimit[] }>("rosters/access.json"),
    getPeople(),
  ])
  const me = todayUserId(session, people, user.name)
  const access = rosterAccess(session.role, me, grants, limits, locations.map((l) => l.id))
  if (!access.editPublished) return null
  return { data: await getLocationAdminData(access), scopeKey: rosterScopeKey(session.tenant.id, session.role.id), me, today: org.today }
}
