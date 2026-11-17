import { TaskDetailSkeleton } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession } from "@/lib/skeleton-session"

// Static (K1, ruling I9): loading.tsx gets no route params and calls no API, so it shows the typical task (the manager's view: write access, review row, voice row).
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "tasks")) return <PageSkeleton />
  const canEdit = canWrite(session, "tasks")
  return <TaskDetailSkeleton canEdit={canEdit} reviewer={canEdit && session.role.home === "manager"} />
}
