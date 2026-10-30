import type { ReportDeadline } from "@/lib/report-deadline"
import type { Dept, Status, Tone } from "@/lib/types"

export type HeaderData = { title: string; subtitle: string }
/** Write access per dashboard action, from the session (read-only roles and suspended tenants see no action buttons). */
export type DashboardPerms = { tasks: boolean; reports: boolean; attention: boolean }
export type SummaryData = {
  stats: {
    title: string
    /** Sprite icon name for the chip beside the title (components/icons.tsx). */
    icon?: string
    ariaLabel: string
    href: string
    value: string
    valueSuffix?: string
    hero?: boolean
    note: { tone?: "up" | "down"; highlight?: string; text: string }
    /** Last 7 days, oldest first, ending on today's value: the sparkline beside the figure. */
    trend?: number[]
    /** Per-department figures (keyed by department name), shown when the topbar filter picks one. Missing = the overall figure. */
    byDept?: Record<string, { value: string; valueSuffix?: string; trend?: number[]; note?: { tone?: "up" | "down"; highlight?: string; text: string } }>
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
    /** Closed count per department, keyed by the tenant's department name (org.departments). */
    byDept: Record<string, number>
    late: number
    avgHours: number
    topCloser: { name: string; count: number }
    tasks: { ref: string; title: string; dept: string; by: string }[]
  }[]
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

// Staff dashboard (SRS §10.1): the signed-in staff member's own work.
export type StaffTaskState = "open" | "blocked" | "review" | "returned"
export type StaffHeaderData = { title: string; subtitle: string }
export type StaffMyTasksData = {
  title: string
  subtitle: string
  action: string
  stats: { key: "open" | "overdue" | "review" | "returned"; title: string; ariaLabel: string; href: string; hero?: boolean; note: string }[]
  tasks: { ref: string; title: string; state: StaffTaskState; due: string; status: Status }[]
}
export type StaffEvidenceData = {
  title: string
  subtitle: string
  items: { ref: string; title: string; state: "review" | "returned"; at: string; reviewer: string; reason?: string; status: Status }[]
}
export type StaffCommentsData = {
  title: string
  subtitle: string
  items: { ref: string; title: string; kind: "submission" | "comment"; by: string; text: string; at: string }[]
}

/** Shift report deadline card (FR-M1-22, FR-M1-28): built on the server by getReportDeadline (features/dashboard/api.ts). */
export type ReportDeadlineCardData = ReportDeadline & {
  /** member = the viewer's own report; team = one row per team in the viewer's report scope. */
  kind: "member" | "team"
  title: string
  note: string
  /** Seconds from the tenant's now to `dueAt` (0 when none). */
  seconds: number
}
