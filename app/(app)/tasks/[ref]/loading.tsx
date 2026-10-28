import { TaskDetailSkeleton } from "@/features/tasks"
import { canWrite, getSession } from "@/lib/session"

// Async so the skeleton matches the role, like /tasks. loading.tsx receives no route params (Next docs, loading.md),
// so it cannot look the task up: item counts are typical values.
export default async function Loading() {
  const session = await getSession()
  const canEdit = canWrite(session, "tasks")
  return <TaskDetailSkeleton canEdit={canEdit} reviewer={canEdit && session.role.home === "manager"} />
}
