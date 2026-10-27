import type { Dept, Status, Tone } from "@/lib/types"

export type HeaderData = { title: string; subtitle: string }
export type SummaryData = {
  stats: {
    title: string
    ariaLabel: string
    value: string
    valueSuffix?: string
    hero?: boolean
    note: { tone?: "up" | "down"; highlight?: string; text: string }
  }[]
}
export type TasksClosedData = {
  title: string
  subtitle: string
  days: {
    d: string
    n: number
    on: number
    t: "s1" | "s2" | "weekend" | "today"
    date: string
    byDept: { security: number; cleaning: number }
    late: number
    avgHours: number
    topCloser: { name: string; count: number }
    tasks: { ref: string; title: string; dept: string; by: string }[]
  }[]
}
export type DailyReportData = {
  title: string
  dueLabel: string
  timezoneNote: string
  deadline: { hour: number; minute: number; timeZone: string }
  reports: { dept: string; detail: string; progress?: number; status: Status }[]
  action: string
}
export type ManagerAttentionData = {
  title: string
  subtitle: string
  items: {
    dep: Dept
    kind: string
    icon: string
    title: string
    by: string
    note: string
    status: Status
  }[]
}
export type TaskProgressData = {
  title: string
  percent: number
  label: string
  ariaLabel: string
  legend: { key: string; label: string; count: number }[]
  layers: { to: number; fill: string }[]
}
export type TeamTasksData = {
  title: string
  tasks: {
    initials: string
    avatar: string
    name: string
    role: string
    task: string
    ref: string
    dept: Dept
    priority: 1 | 2 | 3
    due: string
    late: boolean
    status: Status
  }[]
}
export type CoverageData = {
  title: string
  subtitle: string
  coverage: { count: number; tone: Tone; title: string; detail: string }[]
  expiringDocuments: { title: string; expires: string; badge: Status }[]
}
