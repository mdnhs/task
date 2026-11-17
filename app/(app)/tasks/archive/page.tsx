import { TaskArchive, loadArchive, taskScreenData } from "@/features/tasks"
import { AccessRestricted } from "@/features/shell"
import { classifyApiError } from "@/lib/api/problem"
import { can } from "@/lib/permissions"
import { canWrite, requireMfaOk } from "@/lib/session"

// FR-M1-13: the archive list is for managers (the API answers 403 to anyone else: shown as the restricted state). Managers restore; a tenant admin (settings:write) may purge.
export default async function Page() {
  const session = await requireMfaOk()
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  const { api, people } = await taskScreenData()
  let page
  try {
    page = await loadArchive(api)
  } catch (e) {
    if (classifyApiError(e).kind === "forbidden") return <AccessRestricted moduleLabel="The task archive" />
    throw e
  }
  return (
    <TaskArchive
      tasks={page.tasks}
      nextCursor={page.nextCursor}
      people={people}
      canRestore={canWrite(session, "tasks") && session.role.home === "manager"}
      canPurge={can(session.role, "settings", "write") && session.tenant.status !== "suspended"}
    />
  )
}
