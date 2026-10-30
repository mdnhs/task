import { TasksSkeleton, getProjects, getTaskSeed, checklistProgress, isLate, liveTasks, materialiseRecurring, STATUS } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { EVIDENCE_STATE, evidenceState } from "@/lib/task-evidence"
import { assigneesOf } from "@/lib/task-scope"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Async so the skeleton matches the role: staff see no assignee filter and only their own rows, read-only roles no New task button.
// Rows on the first page with an evidence tag under the status get the extra line (archived tasks are not listed).
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "tasks")) return <PageSkeleton />
  const [{ seed, staff, refFloor, people }, projects, org] = await Promise.all([getTaskSeed(session), getProjects(), getOrg()])
  // The list adds the due instances of recurring series on mount, so the skeleton counts them too.
  const live = liveTasks(materialiseRecurring(seed, org.today, refFloor))
  const labels = live.slice(0, 10).map((t) => {
    const ev = evidenceState(t.evidenceRule, t.evidence, t.status)
    // Real title and ref line (with the repeat / parent / checklist badges) as ghost text, so the stacked rows on phones wrap like the loaded ones.
    const cl = checklistProgress(t)
    const badges = [(t.repeat || t.seriesId) && `\u21bb ${t.repeat ? "Repeats" : "Recurring"}`, t.parentRef && `\u21b3 ${t.parentRef}`, cl && `\u2611 ${cl.done}/${cl.total}`].filter((b): b is string => !!b)
    const a = people.find((p) => p.id === t.assignee)
    return { assignee: a && { name: a.name, more: assigneesOf(t).length - 1, role: a.role }, dept: t.dept, priority: t.priority, due: t.due, late: isLate(t, org.today), title: t.title, meta: t.ref, badges, status: STATUS[t.status].label, ev: ev && ev !== "awaiting" ? EVIDENCE_STATE[ev].label : undefined }
  })
  return <TasksSkeleton canCreate={canWrite(session, "tasks")} staff={staff} rows={live.length} projects={projects.length > 0} labels={labels} today={org.today} tzLabel={org.tzLabel} />
}
