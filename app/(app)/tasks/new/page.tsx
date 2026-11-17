import { NewTaskPage, loadDepartmentTeams, loadProjects, loadShiftPatterns, loadTemplates, parseNewTaskParams, taskScreenData } from "@/features/tasks"
import { AccessRestricted } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, requireMfaOk } from "@/lib/session"

// /tasks/new: the New task form as a page. Opened from the /tasks "New task" button (?from=/tasks…), the dashboard's "New Task" / "Assign Task" (?from=/&then=task) and the
// command palette. ?assignee= presets the assignee. Same gate as the trigger buttons: tasks access with write rights. Staff can only assign themselves (the API says 422
// cannot_assign_others otherwise); a team-scope manager only themselves and their direct reports (422 assignee_out_of_scope).
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, session] = await Promise.all([searchParams, requireMfaOk()])
  if (!can(session.role, "tasks") || !canWrite(session, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  const [{ api, people }, org] = await Promise.all([taskScreenData(), getOrg()])
  const [templates, projects, departments, patterns] = await Promise.all([loadTemplates(api), loadProjects(api), loadDepartmentTeams(api), loadShiftPatterns(api)])
  const params = parseNewTaskParams(sp, people.map((p) => p.id))
  const staff = session.role.home === "staff"
  return (
    <NewTaskPage
      people={people}
      departments={departments}
      today={org.today}
      templates={templates}
      canManageTemplates={session.role.home === "manager"}
      projects={projects}
      patterns={patterns}
      onlyAssignee={staff ? session.user.id : undefined}
      {...params}
    />
  )
}
