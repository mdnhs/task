import { getData } from "@/lib/data"
import { canWrite, type Session } from "@/lib/session"

import type {
  CoverageData,
  DashboardPerms,
  DailyReportData,
  HeaderData,
  ManagerAttentionData,
  StaffCommentsData,
  StaffEvidenceData,
  StaffHeaderData,
  StaffMyTasksData,
  StaffReportData,
  SummaryData,
  TaskProgressData,
  TasksClosedData,
  TeamTasksData,
} from "./types"

// One call per widget, like separate API endpoints; getDashboard loads them in parallel.
export async function getDashboard() {
  const [header, summary, tasksClosed, dailyReport, attention, progress, teamTasks, coverage] = await Promise.all([
    getData<HeaderData>("dashboard/header.json"),
    getData<SummaryData>("dashboard/summary.json"),
    getData<TasksClosedData>("dashboard/tasks-closed.json"),
    getData<DailyReportData>("dashboard/daily-report.json"),
    getData<ManagerAttentionData>("dashboard/manager-attention.json"),
    getData<TaskProgressData>("dashboard/task-progress.json"),
    getData<TeamTasksData>("dashboard/team-tasks.json"),
    getData<CoverageData>("dashboard/coverage.json"),
  ])
  return { header, summary, tasksClosed, dailyReport, attention, progress, teamTasks, coverage }
}

// Just the summary cards, for loading.tsx to know which stat notes wrap.
export const getCoverage = () => getData<CoverageData>("dashboard/coverage.json")
export const getSummary = () => getData<SummaryData>("dashboard/summary.json")

// Just the team tasks, for loading.tsx to size the table skeleton (rows and pager).
export const getTeamTasks = () => getData<TeamTasksData>("dashboard/team-tasks.json")

// Just the report card data, for loading.tsx to know whether the skeleton should include it.
export const getStaffReport = () => getData<StaffReportData>("dashboard/staff/report.json")

// Staff home: "me" is Daniel Okafor for any staff-home role (mock). One file per widget, loaded in parallel.
export async function getStaffDashboard() {
  const [header, myTasks, evidence, report, comments] = await Promise.all([
    getData<StaffHeaderData>("dashboard/staff/header.json"),
    getData<StaffMyTasksData>("dashboard/staff/my-tasks.json"),
    getData<StaffEvidenceData>("dashboard/staff/evidence.json"),
    getStaffReport(),
    getData<StaffCommentsData>("dashboard/staff/comments.json"),
  ])
  return { header, myTasks, evidence, report, comments }
}

// Which owner-dashboard actions the session may take (the view and its skeleton both read this).
export function getDashboardPerms(session: Session): DashboardPerms {
  return { tasks: canWrite(session, "tasks"), reports: canWrite(session, "reports"), attention: canWrite(session, "attention") }
}
