import { NewTaskPage, getNewTaskData } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { SkMask } from "@/components/sk"
import { getMockOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession, getSkeletonUser } from "@/lib/skeleton-session"

// The real form rendered masked (SkMask), from the same data as page.tsx, so every field, row and the template bar match the
// loaded page by construction. Search params (?from, ?assignee) only change link targets and a select's text, not the layout.
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "tasks") || !canWrite(session, "tasks")) return <PageSkeleton />
  const [org, user] = await Promise.all([getMockOrg(), getSkeletonUser()])
  const data = await getNewTaskData(session, user.name, org.departments, org.today)
  return (
    <SkMask label="Loading new task form">
      <NewTaskPage {...data} from="/tasks" assignee="" openCreated={false} />
    </SkMask>
  )
}
