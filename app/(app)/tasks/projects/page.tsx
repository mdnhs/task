import { TaskProjects, loadProjects, taskScreenData, viewerOf } from "@/features/tasks"
import { AccessRestricted } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite, requireMfaOk } from "@/lib/session"

export default async function Page() {
  const session = await requireMfaOk()
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  const { api, people } = await taskScreenData()
  const projects = await loadProjects(api)
  const v = viewerOf(session)
  // Project and milestone deletes are for managers who see everything: a team-scope manager would get 403, so the buttons are not offered.
  return <TaskProjects people={people} projects={projects} canDelete={canWrite(session, "tasks") && v.manager && !v.teamScope} />
}
