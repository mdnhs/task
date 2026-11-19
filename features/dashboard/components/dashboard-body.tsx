"use client"

import { Fragment, useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { useDept } from "@/hooks/use-dept"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { toDashboard, toTeamTasks, type ManagerHome } from "../adapters"
import type { ReportDeadlineCardData, TeamTasksData } from "../types"
import { DeptNote } from "./dept-note"
import { ReportDeadlineCard } from "./report-deadline-card"
import { SectionCards } from "./section-cards"
import { TaskProgress } from "./task-progress"
import { TasksClosedChart } from "./tasks-closed-chart"
import { TeamTasksTable } from "./team-tasks-table"

export type DashboardClock = { tz: string; today: string; nowAt?: string; tzLabel?: string; dueAfterMinutes?: number }
type Scoped = { teamId: string; home: ManagerHome; teamTasks: TeamTasksData | null }

/** The shell's department (a name) as the API's team: `teamId` is the filter; `unknown` = a name no department team has (the figures then stay the whole scope's, with a note). */
export function deptTeam(dept: string, departments: { id: string; name: string }[]): { teamId?: string; unknown: boolean } {
  if (dept === "all") return { unknown: false }
  const id = departments.find((d) => d.name === dept)?.id
  return id ? { teamId: id, unknown: false } : { unknown: true }
}

/**
 * The manager home's figures and team table (B8 Task 24). With a department picked in the topbar, they are the API's answer for that team: GET /v1/dashboard and
 * /v1/dashboard/team-tasks with `teamId` (a task of the team = filed under it or assigned to one of its members, ruling S8), so the summary, the progress, the closed chart, the
 * deadline rows and the table are ONE server cut and add up. Nothing is re-cut here. "All departments" is the server's first answer (no call). `middle` is the attention/coverage row
 * (the attention feed has no team filter: the note says so).
 */
export function DashboardBody({ data, teamTasks, deadline, departments, clock, canRemind, assignTask, middle }: {
  data: ManagerHome
  teamTasks: TeamTasksData | null
  deadline?: ReportDeadlineCardData
  departments: { id: string; name: string }[]
  clock: DashboardClock
  canRemind: boolean
  assignTask?: ReactNode
  middle?: ReactNode
}) {
  const dept = useDept()
  const { teamId, unknown } = deptTeam(dept, departments)
  const [scoped, setScoped] = useState<Scoped | null>(null)
  // The team whose call failed: its figures are NOT the server's first (whole-scope) answer, so an error state with Try again stands in for them (never the wrong numbers under a department).
  const [failed, setFailed] = useState<{ teamId: string; attempt: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const withTable = teamTasks !== null
  useEffect(() => {
    if (!teamId) return
    let live = true
    Promise.all([
      apiBrowser.get("/v1/dashboard", { query: { teamId } }),
      withTable ? apiBrowser.get("/v1/dashboard/team-tasks", { query: { limit: 25, teamId } }) : Promise.resolve(null),
    ])
      .then(([dto, team]) => {
        if (!live) return
        const ctx = { tz: clock.tz, ...(clock.nowAt ? { nowAt: clock.nowAt } : {}), ...(clock.tzLabel ? { tzLabel: clock.tzLabel } : {}), ...(clock.dueAfterMinutes === undefined ? {} : { dueAfterMinutes: clock.dueAfterMinutes }) }
        setScoped({ teamId, home: toDashboard(dto, ctx), teamTasks: team ? toTeamTasks(team, { people: [], tz: clock.tz, today: clock.today }) : null })
      })
      .catch((e: unknown) => {
        if (!live) return
        setFailed({ teamId, attempt })
        toast.error(userMessage(e).text)
      })
    return () => {
      live = false
    }
  }, [teamId, attempt, withTable, clock.tz, clock.today, clock.nowAt, clock.tzLabel, clock.dueAfterMinutes])

  // The team's answer once it is here; until then (and for "all") the server's first answer, marked busy while a team is being asked for.
  const now = teamId && scoped?.teamId === teamId ? scoped : null
  const home = now ? now.home : data
  const table = now ? now.teamTasks : teamTasks
  const card = now ? now.home.deadline : deadline
  if (teamId && !now && failed?.teamId === teamId && failed.attempt === attempt)
    return (
      <>
        <section className="card dash-fail flex flex-wrap items-center justify-between gap-4" role="alert">
          <p>{dept} figures could not be loaded.</p>
          <button type="button" className="btn btn-primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </section>
        <Fragment key="middle">{middle}</Fragment>
      </>
    )
  return (
    <>
      <DeptNote unknown={unknown} />
      <SectionCards data={home.summary} busy={!!teamId && !now} />
      <section className="grid-3 dash-fix dash-fix-a">
        <TasksClosedChart data={home.tasksClosed} />
        <TaskProgress data={home.progress} />
        {card && <ReportDeadlineCard data={card} canRemind={canRemind} />}
      </section>
      {/* `middle` is a server element: while its chunk is still streaming it is a lazy node, not yet an element React could mark as a keyed static child, so the key is stated here */}
      <Fragment key="middle">{middle}</Fragment>
      {table && <TeamTasksTable data={table} assignTask={assignTask} ctx={clock} teamId={now?.teamId} teamName={now ? dept : undefined} />}
    </>
  )
}
