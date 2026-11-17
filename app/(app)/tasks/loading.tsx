import { TASKS_PAGE_SIZE, TasksSkeleton } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Static (K1, ruling I9): no API, no session lookup. The TYPICAL list: a full first page (the API's page size) with the "Load more" button, the manager's filters. The real page then
// replaces it; a role with less access (staff: no assignee filter) sees a small layout change, never a delay.
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "tasks")) return <PageSkeleton />
  return <TasksSkeleton canCreate={canWrite(session, "tasks")} staff={false} rows={TASKS_PAGE_SIZE} projects />
}
