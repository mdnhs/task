import { getData } from "@/lib/data"

import type {
  CoverageData,
  DailyReportData,
  HeaderData,
  ManagerAttentionData,
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
