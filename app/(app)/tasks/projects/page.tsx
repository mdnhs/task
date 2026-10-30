import { TaskProjects, getProjects, getTaskSeed } from "@/features/tasks"
import { AccessRestricted } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { getSession } from "@/lib/session"

export default async function Page() {
  const [session, org] = await Promise.all([getSession(), getOrg()])
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  const [{ people, seed, scopeKey, refFloor }, projects] = await Promise.all([getTaskSeed(session), getProjects()])
  return <TaskProjects tasks={seed} people={people} projects={projects} today={org.today} scopeKey={scopeKey} refFloor={refFloor} />
}
