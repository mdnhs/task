import { isArchiveExpired, milestoneState as domainMilestoneState, progress } from "@opsdesk/domain/task-planning"
import { activeTasks } from "@/lib/task-scope"
import type { Milestone, Project, Task } from "./types"

// Pure planning rules (SRS CR-04): finish-to-start dependencies and the knock-on preview (FR-M1-02, FR-M1-14), the 30-day
// archive (FR-M1-13), projects and milestones (FR-M1-04). Wall-clock strings are read as UTC numbers, so no DST maths.

/** Every assignee (primary first) and "is this person one of them": one rule with search, shift reports and the Today card (lib/task-scope.ts). */
export { assigneesOf, isAssignee as isAssigned } from "@/lib/task-scope"

// ---------- dependencies, knock-on, archive math, progress: the pure rules live in @opsdesk/domain/task-planning (shared with the API) ----------

export { ARCHIVE_DAYS, archiveDaysLeft, dependantsOf, isArchiveExpired, knockOn, waitingOn, wouldCycle, type DateMove, type Progress, type MilestoneState } from "@opsdesk/domain/task-planning"

// ---------- archive (FR-M1-13) ----------

/** Tasks on the board, list and calendar: not archived. */
export const liveTasks = (list: readonly Task[]): Task[] => activeTasks(list)
/** The archive view: archived and still restorable. Expired ones are treated as gone (a backend would purge them). */
export const archivedTasks = (list: readonly Task[], today: string) =>
  list.filter((t) => t.archivedAt && !isArchiveExpired(t.archivedAt, today)).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? ""))

// ---------- projects and milestones (FR-M1-04) ----------

export const projectProgress = (p: Project, tasks: readonly Task[]) => progress(liveTasks(tasks).filter((t) => t.projectId === p.id))

export function milestoneState(m: Milestone, tasks: readonly Task[], today: string) {
  return domainMilestoneState(m, liveTasks(tasks).filter((t) => t.milestoneId === m.id), today)
}

/** Checklist progress "2/4", or null without a checklist. */
export const checklistProgress = (t: Pick<Task, "checklist">) => (t.checklist?.length ? { done: t.checklist.filter((c) => c.done).length, total: t.checklist.length } : null)
