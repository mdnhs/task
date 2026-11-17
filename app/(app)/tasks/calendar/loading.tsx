import { TaskCalendarSkeleton } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Static (K1): the month grid at its minimum cell height; a cell with chips is taller on the real page (T6.9 measures that jump).
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "tasks")) return <PageSkeleton />
  return <TaskCalendarSkeleton staff={false} projects />
}
