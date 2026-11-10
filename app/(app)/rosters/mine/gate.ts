import { getLeaveQueue, getMyExchange, getMyRoster, mineScopeKey, type LeaveQueue, type MyExchange, type MyRosterData } from "@/features/rosters"
import { getUser } from "@/features/shell"
import { getData } from "@/lib/data"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { getPeople } from "@/lib/people"
import { rosterAccess, type LocationGrant, type OfficeLimit } from "@/lib/roster-access"
import { getSession } from "@/lib/session"
import { todayUserId } from "@/lib/today-data"

export type MyRosterGate = { data: MyRosterData; queue: LeaveQueue; exchange: MyExchange; me: string; tz: string; today: string; scopeKey: string }

// Shared by the page and its loading.tsx. The person is the signed-in one (session), never a query. The payload holds only that person's
// published shifts, leave and availability, plus the leave this role may decide (D8), already cut on the server.
export async function myRosterGate(): Promise<MyRosterGate | null> {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "roster")) return null
  const [{ locations }, { grants, limits }, people] = await Promise.all([
    getData<{ locations: { id: string }[] }>("rosters/locations.json"),
    getData<{ grants: LocationGrant[]; limits: OfficeLimit[] }>("rosters/access.json"),
    getPeople(),
  ])
  const me = todayUserId(session, people, user.name)
  const access = rosterAccess(session.role, me, grants, limits, locations.map((l) => l.id))
  if (access.scope === "none") return null
  const [data, queue, exchange] = await Promise.all([getMyRoster(me), getLeaveQueue(access, me), getMyExchange(me, org.today)])
  return { data, queue, exchange, me, tz: org.timezone, today: org.today, scopeKey: mineScopeKey(session.tenant.id, session.role.id) }
}
