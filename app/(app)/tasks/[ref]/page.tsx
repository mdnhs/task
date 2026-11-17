import { TaskDetail, loadProjects, loadShiftPatterns, loadTaskByRef, taskScreenData, viewerOf } from "@/features/tasks"
import { AccessRestricted } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, requireMfaOk } from "@/lib/session"

// Next 16: `params` is a Promise. The ref is resolved through the API: a task the caller may not see answers 404 there, and the page shows "Task not found" (the same for
// another person's task and for a ref that does not exist, so nothing is revealed).
export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const [{ ref }, session] = await Promise.all([params, requireMfaOk()])
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  let taskRef = ref
  try {
    taskRef = decodeURIComponent(ref)
  } catch {
    // malformed escape: look the raw value up, it simply will not be found
  }
  const [{ api, people }, org] = await Promise.all([taskScreenData(), getOrg()])
  const [task, projects, patterns] = await Promise.all([loadTaskByRef(api, taskRef), loadProjects(api), loadShiftPatterns(api)])
  const viewer = viewerOf(session)
  const canEdit = canWrite(session, "tasks")
  return (
    <TaskDetail
      taskRef={taskRef}
      task={task}
      people={people}
      projects={projects}
      today={org.today}
      nowAt={org.nowAt}
      tzLabel={org.tzLabel}
      actor={canEdit && viewer.manager ? "reviewer" : "assignee"}
      canEdit={canEdit}
      viewer={{ id: viewer.id, name: viewer.name, manager: viewer.manager, purge: viewer.purge && session.tenant.status !== "suspended" }}
      driveAllowed={session.drive}
      patterns={patterns}
    />
  )
}
