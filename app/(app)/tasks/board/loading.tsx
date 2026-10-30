import { TaskBoardSkeleton, boardMove, checklistProgress, getProjects, getTaskSeed, liveTasks, materialiseRecurring } from "@/features/tasks"
import type { BoardCardSk, TaskStatus } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { EVIDENCE_STATE, evidenceState } from "@/lib/task-evidence"
import { canWrite, getSession } from "@/lib/session"
import { assigneesOf } from "@/lib/task-scope"

const COLUMNS: TaskStatus[] = ["not_started", "in_progress", "blocked", "submitted", "changes_requested", "completed"]

// Real cards per column (title, checklist chip, evidence tag, Move-to select), recurring instances included, so the board doesn't jump when it loads.
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "tasks")) return <PageSkeleton />
  const [{ seed, staff, refFloor }, projects, org] = await Promise.all([getTaskSeed(session), getProjects(), getOrg()])
  const live = liveTasks(materialiseRecurring(seed, org.today, refFloor))
  const canEdit = canWrite(session, "tasks")
  const actor = canEdit && session.role.home === "manager" ? "reviewer" : "assignee"
  const cards = COLUMNS.map((c) =>
    live
      .filter((t) => t.status === c)
      .map((t): BoardCardSk => {
        const ev = evidenceState(t.evidenceRule, t.evidence, t.status)
        const cl = checklistProgress(t)
        const more = assigneesOf(t).length - 1
        return {
          title: t.title,
          ev: ev ? EVIDENCE_STATE[ev].label : undefined,
          chip: cl ? `☑ ${cl.done}/${cl.total}` : undefined,
          more: more > 0 ? more : undefined,
          move: canEdit && COLUMNS.some((to) => to !== t.status && boardMove(t, to, actor).ok),
        }
      }),
  )
  return <TaskBoardSkeleton staff={staff} projects={projects.length > 0} movable={canEdit} cards={cards} />
}
