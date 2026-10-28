import { TasksView, getTaskSeed, getTemplates, taskCreator, ME_ID, parseFilters, parsePage } from "@/features/tasks"
import { getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { canWrite, getSession } from "@/lib/session"

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, session, org, user] = await Promise.all([searchParams, getSession(), getOrg(), getUser()])
  const [{ people, staff, seed, scopeKey, refFloor }, templates] = await Promise.all([getTaskSeed(session), getTemplates()])
  const initialFilters = parseFilters(sp, people.map((p) => p.id))
  const page = parsePage(sp)
  const initialCreate = sp.new === "1"
  const creator = taskCreator(people, staff, user.name)
  return (
    <TasksView
      key={JSON.stringify(initialFilters) + (initialCreate ? "+new" : "")}
      tasks={seed}
      people={people}
      departments={org.departments}
      today={org.today}
      tzLabel={org.tzLabel}
      canCreate={canWrite(session, "tasks")}
      initialFilters={initialFilters}
      initialPage={page}
      initialCreate={initialCreate}
      onlyAssignee={staff ? ME_ID : undefined}
      creator={creator}
      scopeKey={scopeKey}
      refFloor={refFloor}
      templates={templates}
      canManageTemplates={canWrite(session, "tasks") && session.role.home === "manager"}
    />
  )
}
