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
export type TasksClosedDay = {
  /** Weekday initial. */
  d: string
  /** Tasks closed that tenant day, and the share closed on time (the API gives the count and how many were late; the rest is not recounted). */
  n: number
  on: number
  t: "s1" | "s2" | "weekend" | "today"
  date: string
  late: number
  /** Who closed the most that day; null when nothing was closed. */
  topCloser: { name: string; count: number } | null
}
export type TasksClosedData = { title: string; subtitle: string; days: TasksClosedDay[] }
/** The FR-M1-79 feed (GET /v1/attention) as the card shows it; the decide-and-carry-forward queue is the mock /manager-attention page (G1). */
export type AttentionRow = {
  kind: "red" | "amber" | "blue"
  icon: string
  title: string
  by: string
  note: string
  status: Status
  /** Where the row opens: the task or the report. */
  href: string
}
export type ManagerAttentionData = { title: string; subtitle: string; total: number; items: AttentionRow[] }
export type TaskProgressData = {
  title: string
  percent: number
  label: string
  ariaLabel: string
  legend: { key: string; label: string; count: number }[]
  layers: { to: number; fill: string }[]
}
export type TeamTaskRow = {
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
}
export type TeamTasksData = { title: string; tasks: TeamTaskRow[]; nextCursor: string | null }
export type CoverageData = {
  title: string
  subtitle: string
  coverage: { count: number; tone: Tone; title: string; detail: string }[]
  expiringDocuments: { title: string; expires: string; badge: Status }[]
}

// Staff dashboard (SRS §10.1): the signed-in staff member's own work, from GET /v1/dashboard/staff. The counts are the API's.
export type StaffTaskState = "open" | "blocked" | "review" | "returned"
export type StaffHeaderData = { title: string; subtitle: string }
export type StaffMyTasksData = {
  title: string
  subtitle: string
  action: string
  stats: { key: "open" | "overdue" | "review" | "returned"; title: string; ariaLabel: string; href: string; hero?: boolean; note: string }[]
  counts: Record<"open" | "overdue" | "review" | "returned", number>
  tasks: { ref: string; title: string; state: StaffTaskState; due: string; status: Status }[]
}
export type StaffEvidenceData = {
  title: string
  subtitle: string
  awaitingReview: number
  returned: { ref: string; title: string; reason: string }[]
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

// ---- Today (GET /v1/today, B6 T6.7) ----
import type { DayGroup, DaySummary, TodayCounts, TodayMode, TodayTask, WorkingDay } from "@/lib/today"

/** A task of the day's order; `id` (the uuid) is what "Mark done" sends. */
export type TodayItemTask = TodayTask & { id: string }
export type TodayItem = { task: TodayItemTask; group: DayGroup; reason: string }
/** The Today card as the UI holds it: the numbers, the order and the written summary are the SERVER's (cached 30 s per user; the card refreshes after its own writes). */
export type TodayData = {
  meId: string
  /** The owner of this card's browser preferences: tenant slug and user id (lib/today-prefs todaySubject). */
  subject: string
  day: WorkingDay
  /** The tenant's IANA zone (the card refetches with it). */
  tz: string
  /** Tenant now: a wall time for the date words only (comparisons read instants). */
  now: string
  nowAt: string
  tzLabel: string
  /** Card (open) or chip (closed), from the two cookies the server reads. */
  mode: TodayMode
  counts: TodayCounts
  order: TodayItem[]
  summary: DaySummary
  /** Manager version (FR-M1-79); undefined for staff. */
  team?: { count: number; items: { ref: string; title: string; who: string; reason: string }[] }
  /** The member's own returned plus missing reports. */
  reports: number
}
