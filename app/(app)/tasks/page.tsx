import { redirect } from "next/navigation"

import { TasksView, getProjects, getTaskSeed, ME_ID, parseFilters, parsePage } from "@/features/tasks"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { todayUserId } from "@/lib/today-data"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, session, org, user] = await Promise.all([searchParams, getSession(), getOrg(), getUser()])
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  // Old "New task" links (/tasks?new=1) now open the New task page.
  if (sp.new === "1" && canWrite(session, "tasks")) redirect("/tasks/new")
  const [{ people, staff, seed, scopeKey, refFloor }, projects] = await Promise.all([getTaskSeed(session), getProjects()])
  const initialFilters = parseFilters(sp, people.map((p) => p.id), projects.map((p) => p.id))
  const page = parsePage(sp)
  return (
    <TasksView
      key={JSON.stringify(initialFilters)}
      tasks={seed}
      people={people}
      today={org.today}
      tzLabel={org.tzLabel}
      canCreate={canWrite(session, "tasks")}
      initialFilters={initialFilters}
      initialPage={page}
      onlyAssignee={staff ? ME_ID : undefined}
      reviewerId={staff ? undefined : todayUserId(session, people, user.name)}
      scopeKey={scopeKey}
      refFloor={refFloor}
      projects={projects}
    />
  )
}
