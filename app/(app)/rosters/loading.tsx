import { RostersSkeleton, getRosterData, rosterScopeKey, getHolidayDates, getRosterExchange, getRosterHistory, getRosterRequests, getRosterRules, getWeekTemplates, rosterEdit, rosterViewData } from "@/features/rosters"
import { PageSkeleton, getUser } from "@/features/shell"
import { getData } from "@/lib/data"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { getPeople } from "@/lib/people"
import { rosterAccess, type LocationGrant, type OfficeLimit } from "@/lib/roster-access"
import { getSession } from "@/lib/session"
import { todayUserId } from "@/lib/today-data"

// Async so the skeleton is the real view for the role's default location and the current week (loading.tsx gets no params).
export default async function Loading() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "roster")) return <PageSkeleton />
  const [{ locations }, { grants, limits }, people] = await Promise.all([
    getData<{ locations: { id: string; name: string }[] }>("rosters/locations.json"),
    getData<{ grants: LocationGrant[]; limits: OfficeLimit[] }>("rosters/access.json"),
    getPeople(),
  ])
  const me = todayUserId(session, people, user.name)
  const access = rosterAccess(session.role, me, grants, limits, locations.map((l) => l.id))
  if (access.scope === "none") return <PageSkeleton />
  const data = await getRosterData(access, me)
  const view = rosterViewData(data, access, {}, org.today)
  if ("denied" in view) return <PageSkeleton />
  const editor = access.editDraft || access.editPublished
  const extra = editor
    ? { rules: await getRosterRules(access), tz: org.timezone, history: await getRosterHistory(access), requests: await getRosterRequests(access), weekTemplates: await getWeekTemplates(access), holidays: await getHolidayDates(), exchange: await getRosterExchange(access), gapsLink: can(session.role, "staff") }
    : undefined
  return <RostersSkeleton data={view} edit={extra && rosterEdit(data, access, {}, rosterScopeKey(session.tenant.id, session.role.id), me, org.today, extra)} />
}
