import { NewTaskPage } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { SkMask } from "@/components/sk"
import { can } from "@/lib/permissions"
import { canWrite } from "@/lib/permissions"
import { getSkeletonSession, getSkeletonUser } from "@/lib/skeleton-session"

// Static (K1): the real form rendered masked (SkMask) with typical placeholder data (one person, one department, one template, so the template bar is there), so every field
// and row matches the loaded page by construction. Search params (?from, ?assignee) only change link targets and a select's text, not the layout.
export default async function Loading() {
  const session = await getSkeletonSession()
  if (!can(session.role, "tasks") || !canWrite(session, "tasks")) return <PageSkeleton />
  const user = await getSkeletonUser()
  const me = { id: "skeleton", name: user.name, role: user.role, initials: user.initials, avatar: "av1" as const, dept: "" }
  const template = { id: "t", version: 1, teamId: null, name: "Template", title: "", description: "", dept: "", priority: 2 as const, tags: [], evidenceRule: { mode: "none" as const, types: [], min: 0, instruction: "", review: "manager" as const }, dueOffset: 0, dueTime: "17:00" }
  return (
    <SkMask label="Loading new task form">
      <NewTaskPage people={[me]} departments={[{ id: "d", name: "Department" }]} today="2026-01-01T09:00:00" templates={[template]} canManageTemplates projects={[]} patterns={[]} from="/tasks" assignee="" openCreated={false} />
    </SkMask>
  )
}
