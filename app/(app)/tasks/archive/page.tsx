import { TaskArchive, getTaskSeed, ME_ID } from "@/features/tasks"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// FR-M1-13: managers restore; a tenant admin (settings write) may purge before the 30 days are up.
export default async function Page() {
  const [session, org, user] = await Promise.all([getSession(), getOrg(), getUser()])
  if (!can(session.role, "tasks")) return <AccessRestricted moduleLabel="Tasks" />
  const { people, staff, seed, scopeKey, refFloor } = await getTaskSeed(session)
  const me = (staff && people.find((p) => p.id === ME_ID)?.name) || user.name
  return (
    <TaskArchive
      tasks={seed}
      people={people}
      today={org.today}
      scopeKey={scopeKey}
      refFloor={refFloor}
      onlyAssignee={staff ? ME_ID : undefined}
      canRestore={canWrite(session, "tasks") && session.role.home === "manager"}
      canPurge={can(session.role, "settings", "write") && session.tenant.status !== "suspended"}
      me={me}
      meRole={session.role.label}
    />
  )
}
