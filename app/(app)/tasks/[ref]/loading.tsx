import { TaskDetail, TaskDetailLoading, TaskDetailSkeleton, getProjects, getTaskSeed, ME_ID } from "@/features/tasks"
import { PageSkeleton, getUser } from "@/features/shell"
import { SkMask } from "@/components/sk"
import { getDeviceContext } from "@/lib/device-session"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { lastSegment } from "@/lib/request-path"
import { canWrite, getSession } from "@/lib/session"

// loading.tsx gets no route params, so the ref comes from the pathname header proxy.ts sets (lib/request-path.ts). The real task is
// rendered masked (SkMask), so every card, row and wrapped line matches the loaded page. A ref the seed lacks goes to TaskDetailLoading
// (client): masked too when this tab's store has it (tasks created here, e.g. with voice instructions), else the typical-counts skeleton.
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "tasks")) return <PageSkeleton />
  const canEdit = canWrite(session, "tasks")
  const manager = session.role.home === "manager"
  const ref = await lastSegment("/tasks/")
  const [{ people, staff, seed, scopeKey, refFloor }, projects, org, user, { canDrive }] = await Promise.all([getTaskSeed(session), getProjects(), getOrg(), getUser(), getDeviceContext(session)])
  if (!ref) return <TaskDetailSkeleton canEdit={canEdit} reviewer={canEdit && manager} />
  const me = (staff && people.find((p) => p.id === ME_ID)?.name) || user.name
  // Not in the seed: maybe created in this tab (client store only, e.g. with voice instructions). The client decides.
  if (!seed.some((t) => t.ref === ref))
    return <TaskDetailLoading skeleton={{ canEdit, reviewer: canEdit && manager }} taskRef={ref} seed={seed} scopeKey={scopeKey} people={people} projects={projects} today={org.today} tzLabel={org.tzLabel} actor={canEdit && manager ? "reviewer" : "assignee"} canEdit={canEdit} me={me} refFloor={refFloor} driveAllowed={canDrive} />
  return (
    <SkMask label="Loading task">
      <TaskDetail taskRef={ref} seed={seed} scopeKey={scopeKey} people={people} projects={projects} today={org.today} tzLabel={org.tzLabel} actor={canEdit && manager ? "reviewer" : "assignee"} canEdit={canEdit} me={me} refFloor={refFloor} driveAllowed={canDrive} />
    </SkMask>
  )
}
