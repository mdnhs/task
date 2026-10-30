import { daysBetween, isOverdue } from "@/lib/dates"
import { isOpen } from "./lifecycle"
import { isAssigned } from "./planning"
import { STATUS_ORDER } from "./types"
import type { Task, TasksFilters } from "./types"

export const DUE_VALUES = ["all", "today", "overdue", "week"] as const
export const TASKS_PAGE_SIZE = 10
export const EMPTY_FILTERS: TasksFilters = { status: "all", due: "all", priority: "all", assignee: "all", q: "", repeat: "all", project: "all" }

type Raw = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

// Reads ?status=&due=&priority=&assignee=&project=&q= (Next hands searchParams over as a plain object). Unknown values fall back to "all".
export function parseFilters(sp: Raw, assignees: string[] = [], projects: string[] = []): TasksFilters {
  const status = one(sp.status)
  const due = one(sp.due)
  const priority = one(sp.priority)
  const assignee = one(sp.assignee)
  const repeat = one(sp.repeat)
  const project = one(sp.project)
  return {
    status: status === "open" || status === "stuck" || status === "review" || STATUS_ORDER.includes(status as never) ? (status as string) : "all",
    due: DUE_VALUES.includes(due as never) ? (due as string) : "all",
    priority: priority === "1" || priority === "2" || priority === "3" ? priority : "all",
    assignee: assignee && assignees.includes(assignee) ? assignee : "all",
    repeat: repeat === "recurring" ? repeat : "all",
    project: project && (project === "none" || projects.includes(project)) ? project : "all",
    q: (one(sp.q) ?? "").slice(0, 100),
  }
}

// Reads ?page= (1-based). Anything that is not a positive integer is page 1; paginate() clamps the upper end.
export function parsePage(sp: Raw): number {
  const n = Number(one(sp.page))
  return Number.isInteger(n) && n > 0 ? n : 1
}

/** "none" = tasks outside any project. */
export const matchesProject = (t: Task, project: string) => project === "all" || (project === "none" ? !t.projectId : t.projectId === project)

/** "recurring" = series tasks and the instances they made. */
export const matchesRepeat = (t: Task, repeat: string) => repeat !== "recurring" || !!t.repeat || !!t.seriesId

export function matchesDue(t: Task, due: string, today: string): boolean {
  if (due === "today") return daysBetween(t.due, today) === 0
  if (due === "overdue") return isOpen(t) && isOverdue(t.due, today)
  if (due === "week") {
    const d = daysBetween(t.due, today)
    return d >= 0 && d <= 7
  }
  return true
}

// "stuck" = open and (blocked or past due): the staff "Overdue / blocked" card.
// "review" = submitted and waiting for this reviewer: not one of `reviewerId`'s own tasks (the Today card's review tile).
export function matchesStatus(t: Task, status: string, today: string, reviewerId?: string): boolean {
  if (status === "all") return true
  if (status === "open") return isOpen(t)
  if (status === "review") return t.status === "submitted" && !(reviewerId && isAssigned(t, reviewerId))
  if (status === "stuck") return isOpen(t) && (t.status === "blocked" || isOverdue(t.due, today))
  return t.status === status
}
