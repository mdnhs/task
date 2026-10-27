import type { getDashboard } from "../api"
import { CoverageFiles } from "./coverage-files"
import { DailyReportDeadline } from "./daily-report-deadline"
import { ManagerAttention } from "./manager-attention"
import { PageHeader } from "./page-header"
import { SectionCards } from "./section-cards"
import { TaskProgress } from "./task-progress"
import { TasksClosedChart } from "./tasks-closed-chart"
import { TeamTasksTable } from "./team-tasks-table"

export function DashboardView({ data }: { data: Awaited<ReturnType<typeof getDashboard>> }) {
  return (
    <>
      <PageHeader data={data.header} />
      <SectionCards data={data.summary} />
      <section className="grid-2">
        <TasksClosedChart data={data.tasksClosed} />
        <DailyReportDeadline data={data.dailyReport} />
      </section>
      <section className="grid-2">
        <ManagerAttention data={data.attention} />
        <TaskProgress data={data.progress} />
      </section>
      <section className="grid-2">
        <TeamTasksTable data={data.teamTasks} />
        <CoverageFiles data={data.coverage} />
      </section>
    </>
  )
}
