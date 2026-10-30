import { getData } from "@/lib/data"
import type { Org } from "@/lib/org"
import { getPeople } from "@/lib/people"
import { reportScope } from "@/lib/permissions"
import { memberDeadline, secondsUntil, teamDeadline } from "@/lib/report-deadline"
import { inScope, scopeReports } from "@/lib/shift-report"
import { getShiftReportData } from "@/lib/shift-reports-data"
import { canWrite, type Session } from "@/lib/session"
import { todayUserId } from "@/lib/today-data"

import type {
  CoverageData,
  DashboardPerms,
  HeaderData,
  ReportDeadlineCardData,
  ManagerAttentionData,
  StaffCommentsData,
  StaffEvidenceData,
  StaffHeaderData,
  StaffMyTasksData,
  SummaryData,
  TaskProgressData,
  TasksClosedData,
  TeamTasksData,
} from "./types"

// One call per widget, like separate API endpoints; getDashboard loads them in parallel.
export async function getDashboard() {
  const [header, summary, tasksClosed, attention, progress, teamTasks, coverage] = await Promise.all([
    getData<HeaderData>("dashboard/header.json"),
    getData<SummaryData>("dashboard/summary.json"),
    getData<TasksClosedData>("dashboard/tasks-closed.json"),
    getData<ManagerAttentionData>("dashboard/manager-attention.json"),
    getData<TaskProgressData>("dashboard/task-progress.json"),
    getData<TeamTasksData>("dashboard/team-tasks.json"),
    getData<CoverageData>("dashboard/coverage.json"),
  ])
  return { header, summary, tasksClosed, attention, progress, teamTasks, coverage }
}

// Just the summary cards, for loading.tsx to know which stat notes wrap.
export const getCoverage = () => getData<CoverageData>("dashboard/coverage.json")
export const getSummary = () => getData<SummaryData>("dashboard/summary.json")

// Just the team tasks, for loading.tsx to size the table skeleton (rows and pager).
export const getTeamTasks = () => getData<TeamTasksData>("dashboard/team-tasks.json")

// Staff home: "me" is Daniel Okafor for any staff-home role (mock). One file per widget, loaded in parallel.
export async function getStaffDashboard() {
  const [header, myTasks, evidence, comments] = await Promise.all([
    getData<StaffHeaderData>("dashboard/staff/header.json"),
    getData<StaffMyTasksData>("dashboard/staff/my-tasks.json"),
    getData<StaffEvidenceData>("dashboard/staff/evidence.json"),
    getData<StaffCommentsData>("dashboard/staff/comments.json"),
  ])
  return { header, myTasks, evidence, comments }
}

// Which owner-dashboard actions the session may take (the view and its skeleton both read this).
export function getDashboardPerms(session: Session): DashboardPerms {
  return { tasks: canWrite(session, "tasks"), reports: canWrite(session, "reports"), attention: canWrite(session, "attention") }
}

/**
 * Shift report deadline card (FR-M1-22, FR-M1-28, FR-M1-30), cut to the viewer's report scope on the server: a member gets
 * only their own report, a manager the teams in scope. Undefined when the role has no reports access or nothing to show
 * (no reporting shift in the window), so the page and loading.tsx leave the card out alike.
 */
export async function getReportDeadline(session: Session, org: Org, userName?: string): Promise<ReportDeadlineCardData | undefined> {
  const people = await getPeople()
  const meId = todayUserId(session, people, userName)
  const scope = reportScope(session.role, meId)
  if (!scope) return undefined
  const data = await getShiftReportData(org)
  const rows = scopeReports(data.rows, scope, data.shifts.members)
  const tz = org.timezone
  const note = `${org.tzLabel} · shift end + ${data.shifts.reporting.dueAfterMinutes} min`
  const d =
    scope.kind === "own"
      ? { kind: "member" as const, title: "My shift report", ...memberDeadline(scope.personId, rows, data.shifts, org.today, tz) }
      : { kind: "team" as const, title: "Shift report deadline", ...teamDeadline(rows, org.departments, data.shifts, org.today, tz, (p) => inScope(p, scope, data.shifts.members)) }
  if (!d.dueAt && !d.rows.length) return undefined
  return { ...d, note, seconds: secondsUntil(d.dueAt, org.today, tz) }
}
