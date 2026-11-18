import type { ReactNode } from "react"

import type { ManagerHome } from "../adapters"
import type { CoverageData, DashboardPerms, HeaderData, ManagerAttentionData, ReportDeadlineCardData, TeamTasksData, TodayData } from "../types"
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
 * The manager home on the API's read models (B6 T6.7): every figure is the DTO's. `newTask` / `assignTask` are New task triggers built by the page from the tasks feature (features don't import each
 * other). `coverage` is the mock Coverage & Files card (rosters and employee files have no backend; the page passes it only on a demo deployment, I16).
 */
export function DashboardView({
  header,
  data,
  teamTasks,
  attention,
  perms,
  newTask,
  assignTask,
  today,
  deadline,
  coverage,
  remind = false,
  clock,
}: {
  header: HeaderData
  data: ManagerHome
  /** Null when the caller may not read tasks (the card is left out, 403). */
  teamTasks: TeamTasksData | null
  /** Null when the caller has no attention access. */
  attention: (ManagerAttentionData & { nextCursor: string | null }) | null
  perms: DashboardPerms
  newTask?: ReactNode
  assignTask?: ReactNode
  /** The Today card data (FR-M1-70), cut to this user by the API; null/undefined = no card (a support session gets 403). */
  today?: TodayData | null
  /** Shift report deadline for the teams in the viewer's scope; undefined = no card. */
  deadline?: ReportDeadlineCardData
  coverage?: CoverageData
  /** The "Remind N missing" button (a mock until reminders have a backend): shown on a demo deployment only. */
  remind?: boolean
  /** The tenant zone and wall "now" the table's date words use when it loads more rows. */
  clock: { tz: string; today: string }
}) {
  return (
    <>
      <PageHeader data={header} perms={perms} newTask={newTask} />
      {today && <TodayCard data={today} />}
      <SectionCards data={data.summary} />
      <section className="grid-3 dash-fix dash-fix-a">
        <TasksClosedChart data={data.tasksClosed} />
        <TaskProgress data={data.progress} />
        {deadline && <ReportDeadlineCard data={deadline} canRemind={perms.reports && remind} />}
      </section>
      {(attention || coverage) && (
        <section className="grid-2 dash-fix dash-fix-c" style={coverage ? undefined : { gridTemplateColumns: "minmax(0,1fr)" }}>
          {attention && <ManagerAttention data={attention} />}
          {coverage && <CoverageFiles data={coverage} />}
        </section>
      )}
      {teamTasks && <TeamTasksTable data={teamTasks} assignTask={perms.tasks && assignTask} ctx={clock} />}
    </>
  )
}
