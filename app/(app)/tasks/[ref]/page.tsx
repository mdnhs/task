import { TaskDetail, getTaskSeed, ME_ID } from "@/features/tasks"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Next 16: `params` is a Promise. The store is seeded exactly like /tasks (same seed, same scopeKey), so a staff user
// who opens someone else's ref gets "Task not found" from the client lookup (still HTTP 200; no 404 status needed).
export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const [{ ref }, session, org, user] = await Promise.all([params, getSession(), getOrg(), getUser()])
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  const { people, staff, seed, scopeKey, refFloor } = await getTaskSeed(session)
  let taskRef = ref
  try {
    taskRef = decodeURIComponent(ref)
  } catch {
    // malformed escape: look the raw value up, it simply will not be found
  }
  const manager = session.role.home === "manager"
  const canEdit = canWrite(session, "tasks")
  // Staff roles act as "me" (Daniel); managers act as the signed-in user from the shell.
  const me = (staff && people.find((p) => p.id === ME_ID)?.name) || user.name
  return (
    <TaskDetail
      taskRef={taskRef}
      seed={seed}
      scopeKey={scopeKey}
      people={people}
      today={org.today}
      tzLabel={org.tzLabel}
      actor={canEdit && manager ? "reviewer" : "assignee"}
      canEdit={canEdit}
      me={me}
      refFloor={refFloor}
    />
  )
}
