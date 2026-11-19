import { TaskCalendar, loadCalendar, loadDepartmentTeams, loadProjects, rangeOf, taskScreenData } from "@/features/tasks"
import { AccessRestricted } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { requireMfaOk } from "@/lib/session"

// The month the calendar opens on is asked of the API in the TENANT's days (it cuts them in the tenant zone, DST days included). Moving to another month asks again.
export default async function Page() {
  const session = await requireMfaOk()
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  const [{ api, people }, org] = await Promise.all([taskScreenData(), getOrg()])
  const range = rangeOf(org.today.slice(0, 10), "month")
  const [cal, projects, departments] = await Promise.all([loadCalendar(api, range.from, range.to), loadProjects(api), loadDepartmentTeams(api)])
  return <TaskCalendar tasks={cal.tasks} truncated={cal.truncated} range={range} people={people} projects={projects} today={org.today} tzLabel={org.tzLabel} staff={session.role.home === "staff"} departments={departments} />
}
