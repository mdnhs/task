import type { ReactNode } from "react"

import type { getDashboard } from "../api"
import type { DashboardPerms } from "../types"
import { CoverageFiles } from "./coverage-files"
import { DailyReportDeadline } from "./daily-report-deadline"
import { ManagerAttention } from "./manager-attention"
import { PageHeader } from "./page-header"
import { SectionCards } from "./section-cards"
import { TaskProgress } from "./task-progress"
import { TasksClosedChart } from "./tasks-closed-chart"
import { TeamTasksTable } from "./team-tasks-table"

/**
 * `newTask` / `assignTask` are New task triggers built by the page from the tasks feature (features don't import each
 * other). They open the dialog in place and go to the new task only after it is created.
 */
export function DashboardView({
  data,
  perms,
  newTask,
  assignTask,
}: {
  data: Awaited<ReturnType<typeof getDashboard>>
  perms: DashboardPerms
  newTask?: ReactNode
  assignTask?: ReactNode
}) {
  return (
    <>
      <PageHeader data={data.header} perms={perms} newTask={newTask} />
      <SectionCards data={data.summary} />
      <section className="grid-2 dash-fix dash-fix-a">
        <TasksClosedChart data={data.tasksClosed} />
        <DailyReportDeadline data={data.dailyReport} canRemind={perms.reports} />
      </section>
      <section className="grid-2 dash-fix dash-fix-b">
        <ManagerAttention data={data.attention} canDecide={perms.attention} />
        <TaskProgress data={data.progress} />
      </section>
      <section className="grid-2">
        <TeamTasksTable data={data.teamTasks} assignTask={perms.tasks && assignTask} />
        <CoverageFiles data={data.coverage} />
      </section>
    </>
  )
}
