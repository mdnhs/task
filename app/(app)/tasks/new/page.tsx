import { NewTaskPage, getNewTaskData, parseNewTaskParams } from "@/features/tasks"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// /tasks/new: the New task form as a page (it was a dialog that scrolled). Opened from the /tasks "New task" button
// (?from=/tasks…), the dashboard's "New Task" / "Assign Task" (?from=/&then=task) and the command palette.
// ?assignee= presets the assignee. Same gate as the trigger buttons: tasks access with write rights.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, session, org, user] = await Promise.all([searchParams, getSession(), getOrg(), getUser()])
  if (!can(session.role, "tasks") || !canWrite(session, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  const data = await getNewTaskData(session, user.name, org.departments, org.today)
  const params = parseNewTaskParams(sp, data.people.map((p) => p.id))
  return <NewTaskPage {...data} {...params} />
}
