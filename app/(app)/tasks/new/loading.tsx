import { NewTaskPage, getNewTaskData } from "@/features/tasks"
import { PageSkeleton, getUser } from "@/features/shell"
import { SkMask } from "@/components/sk"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// The real form rendered masked (SkMask), from the same data as page.tsx, so every field, row and the template bar match the
// loaded page by construction. Search params (?from, ?assignee) only change link targets and a select's text, not the layout.
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "tasks") || !canWrite(session, "tasks")) return <PageSkeleton />
  const [org, user] = await Promise.all([getOrg(), getUser()])
  const data = await getNewTaskData(session, user.name, org.departments, org.today)
  return (
    <SkMask label="Loading new task form">
      <NewTaskPage {...data} from="/tasks" assignee="" openCreated={false} />
    </SkMask>
  )
}
