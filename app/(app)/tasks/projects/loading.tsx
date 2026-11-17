import { TaskProjectsSkeleton } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Static (K1): two typical project cards with two milestones each.
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "tasks")) return <PageSkeleton />
  return <TaskProjectsSkeleton milestones={[2, 2]} canDelete />
}
