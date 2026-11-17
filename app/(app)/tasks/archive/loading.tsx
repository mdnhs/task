import { TaskArchiveSkeleton } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Static (K1): one typical archived task with its Restore and Delete now buttons.
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "tasks")) return <PageSkeleton />
  const actions = (canWrite(session, "tasks") && session.role.home === "manager") || can(session.role, "settings", "write")
  return <TaskArchiveSkeleton rows={1} actions={actions} />
}
