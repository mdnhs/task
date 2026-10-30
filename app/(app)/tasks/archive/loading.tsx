import { TaskArchiveSkeleton, archivedTasks, getTasks, isAssigned, ME_ID } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

export default async function Loading() {
  const [session, { tasks }, org] = await Promise.all([getSession(), getTasks(), getOrg()])
  if (!can(session.role, "tasks")) return <PageSkeleton />
  const staff = session.role.home === "staff"
  const archived = archivedTasks(staff ? tasks.filter((t) => isAssigned(t, ME_ID)) : tasks, org.today)
  const actions = (canWrite(session, "tasks") && session.role.home === "manager") || can(session.role, "settings", "write")
  return <TaskArchiveSkeleton rows={archived.length} actions={actions} tasks={archived.map((t) => ({ ref: t.ref, title: t.title }))} />
}
