import { TaskBoardSkeleton } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Static (K1): the typical board, the skeleton's default cards per column (2 or 3), with the Move-to select on each.
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "tasks")) return <PageSkeleton />
  return <TaskBoardSkeleton staff={false} projects movable={canWrite(session, "tasks")} />
}
