import { TasksSkeleton, getTasks, ME_ID } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Async so the skeleton matches the role: staff see no assignee filter and only their own rows, read-only roles no New task button.
export default async function Loading() {
  const [session, { tasks }] = await Promise.all([getSession(), getTasks()])
  if (!can(session.role, "tasks")) return <PageSkeleton />
  const staff = session.role.home === "staff"
  const rows = staff ? tasks.filter((t) => t.assignee === ME_ID).length : tasks.length
  return <TasksSkeleton canCreate={canWrite(session, "tasks")} staff={staff} rows={rows} />
}
