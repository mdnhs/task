import { checkAssignRules, checkWeekRules } from "./actions"
import { RostersView, getRosterData, rosterScopeKey, getHolidayDates, getRosterExchange, getRosterHistory, getRosterRequests, getRosterRules, getWeekTemplates, rosterEdit, rosterViewData } from "@/features/rosters"
import { AccessRestricted, getUser } from "@/features/shell"
import { getData } from "@/lib/data"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { getPeople } from "@/lib/people"
import { rosterAccess, type LocationGrant, type OfficeLimit } from "@/lib/roster-access"
import { getSession } from "@/lib/session"
import { todayUserId } from "@/lib/today-data"

// Location Rosters (Module 1A, FR-RS-10/11/12/33). The role's location access cuts the payload on the server (D4); a location the
// role may not open shows "no access" and none of its data is sent.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, session, org, user] = await Promise.all([searchParams, getSession(), getOrg(), getUser()])
  if (!can(session.role, "roster")) return <AccessRestricted moduleLabel="Location Rosters" />
  const [{ locations }, { grants, limits }, people] = await Promise.all([
    getData<{ locations: { id: string; name: string }[] }>("rosters/locations.json"),
    getData<{ grants: LocationGrant[]; limits: OfficeLimit[] }>("rosters/access.json"),
    getPeople(),
  ])
  const me = todayUserId(session, people, user.name)
  const access = rosterAccess(session.role, me, grants, limits, locations.map((l) => l.id))
  if (access.scope === "none") return <AccessRestricted moduleLabel="Location Rosters" />
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined)
  const data = await getRosterData(access, me)
  const query = { location: one("location"), week: one("week"), view: one("view"), group: one("group") }
  const view = rosterViewData(data, access, query, org.today)
  if ("denied" in view) return <AccessRestricted moduleLabel="Location Rosters" />
  // Rule data, history and requests are only sent to roles that can edit, already cut to the caller's locations.
  const editor = access.editDraft || access.editPublished
  const extra = editor
    ? { rules: await getRosterRules(access), tz: org.timezone, history: await getRosterHistory(access), requests: await getRosterRequests(access), weekTemplates: await getWeekTemplates(access), holidays: await getHolidayDates(), exchange: await getRosterExchange(access), gapsLink: can(session.role, "staff") }
    : undefined
  return <RostersView data={view} edit={extra && rosterEdit(data, access, query, rosterScopeKey(session.tenant.id, session.role.id), me, org.today, extra, checkWeekRules, checkAssignRules)} />
}
