import { TaskCalendar, getProjects, getTaskSeed, ME_ID } from "@/features/tasks"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Same seed + scopeKey as /tasks, so edits made on any task view show on the others (FR-M1-05).
export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  const [{ people, staff, seed, scopeKey, refFloor }, projects] = await Promise.all([getTaskSeed(session), getProjects()])
  const canEdit = canWrite(session, "tasks")
  const me = (staff && people.find((p) => p.id === ME_ID)?.name) || user.name
  return (
    <TaskCalendar
      tasks={seed}
      people={people}
      projects={projects}
      today={org.today}
      tzLabel={org.tzLabel}
      scopeKey={scopeKey}
      refFloor={refFloor}
      onlyAssignee={staff ? ME_ID : undefined}
      canEdit={canEdit}
      actor={canEdit && session.role.home === "manager" ? "reviewer" : "assignee"}
      me={me}
    />
  )
}
