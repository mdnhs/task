import type { ReactNode } from "react"

import type { getDashboard } from "../api"
import type { TodayData } from "@/lib/today-data"
import type { DashboardPerms, ReportDeadlineCardData } from "../types"
import { CoverageFiles } from "./coverage-files"
import { ManagerAttention } from "./manager-attention"
import { PageHeader } from "./page-header"
import { ReportDeadlineCard } from "./report-deadline-card"
import { SectionCards } from "./section-cards"
import { TaskProgress } from "./task-progress"
import { TodayCard } from "./today-card"
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
  today,
  deadline,
}: {
  data: Awaited<ReturnType<typeof getDashboard>>
  perms: DashboardPerms
  newTask?: ReactNode
  assignTask?: ReactNode
  /** The Today card data (FR-M1-70), cut to this user on the server. */
  today?: TodayData
  /** Shift report deadline for the teams in the viewer's scope; undefined = no card. */
  deadline?: ReportDeadlineCardData
}) {
  return (
    <>
      <PageHeader data={data.header} perms={perms} newTask={newTask} />
      {today && <TodayCard data={today} />}
      <SectionCards data={data.summary} />
      <section className="grid-3 dash-fix dash-fix-a">
        <TasksClosedChart data={data.tasksClosed} />
        <TaskProgress data={data.progress} />
        {deadline && <ReportDeadlineCard data={deadline} canRemind={perms.reports} />}
      </section>
      <section className="grid-2 dash-fix dash-fix-c">
        <ManagerAttention data={data.attention} canDecide={perms.attention} />
        <CoverageFiles data={data.coverage} />
      </section>
      <TeamTasksTable data={data.teamTasks} assignTask={perms.tasks && assignTask} />
    </>
  )
}
