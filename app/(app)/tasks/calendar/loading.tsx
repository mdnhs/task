import { TaskCalendarSkeleton, byDueDay, getProjects, getTaskSeed, liveTasks, materialiseRecurring, monthGrid } from "@/features/tasks"
import type { CalCellSk } from "@/features/tasks"
import { PageSkeleton } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { getSession } from "@/lib/session"

// Chips per month cell before "+n more" (MONTH_CHIPS in task-calendar.tsx).
const MONTH_CHIPS = 3

// The month grid of today's month with the real chips as ghost text: a cell with chips is taller than the 112px minimum, so the rows must match.
export default async function Loading() {
  const session = await getSession()
  if (!can(session.role, "tasks")) return <PageSkeleton />
  const [{ seed, staff, refFloor }, projects, org] = await Promise.all([getTaskSeed(session), getProjects(), getOrg()])
  const days = byDueDay(liveTasks(materialiseRecurring(seed, org.today, refFloor)))
  const weeks = monthGrid(org.today.slice(0, 10)).map((week) =>
    week.map((d): CalCellSk => {
      const list = days.get(d) ?? []
      return {
        day: Number(d.slice(8, 10)),
        chips: list.slice(0, MONTH_CHIPS).map((t) => `${t.due.slice(11, 16)} ${t.title}`),
        more: Math.max(0, list.length - MONTH_CHIPS),
        total: list.length,
      }
    }),
  )
  return <TaskCalendarSkeleton staff={staff} projects={projects.length > 0} weeks={weeks} />
}
