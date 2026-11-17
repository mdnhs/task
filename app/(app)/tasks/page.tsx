import { redirect } from "next/navigation"

import { TasksView, TASKS_PAGE_SIZE, listQuery, loadProjects, loadTaskPage, parseFilters, taskScreenData } from "@/features/tasks"
import { AccessRestricted } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, requireMfaOk } from "@/lib/session"

// The list is the API's: filters, scope and cursor paging are answered by GET /v1/tasks (staff only get their own tasks from the server; nothing is re-scoped here).
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireMfaOk()
  const sp = await searchParams
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  // Old "New task" links (/tasks?new=1) now open the New task page.
  if (sp.new === "1" && canWrite(session, "tasks")) redirect("/tasks/new")
  const [{ api, people }, org] = await Promise.all([taskScreenData(), getOrg()])
  const projects = await loadProjects(api)
  const filters = parseFilters(sp, people.map((p) => p.id), projects.map((p) => p.id))
  const page = await loadTaskPage(api, { ...listQuery(filters), limit: TASKS_PAGE_SIZE })
  return (
    <TasksView
      key={JSON.stringify(filters)}
      tasks={page.tasks}
      nextCursor={page.nextCursor}
      people={people}
      today={org.today}
      nowAt={org.nowAt}
      tzLabel={org.tzLabel}
      canCreate={canWrite(session, "tasks")}
      initialFilters={filters}
      staff={session.role.home === "staff"}
      projects={projects}
    />
  )
}
