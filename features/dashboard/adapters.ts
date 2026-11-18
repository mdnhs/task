// Pure mappers between the dashboard, attention and Today API DTOs and the UI's widget data (B6 T6.7). Every FIGURE is the DTO's: nothing is recounted on the client. A missing or extra field
// throws (Review Focus 4). Times (I12): wall strings for display are derived from the stored INSTANTS in the tenant zone; the report-deadline countdown is `dueAt` minus `nowAt`, so the DST
// fold (25 Oct 2026) and gap (28 Mar 2027) cannot move it by an hour.
import { initialsOf } from "@/lib/branding"
import { formatDate, formatDateYear, formatDue, formatTime } from "@/lib/dates"
import { avatarFor } from "@/lib/avatar"
import { dueLabel } from "@/lib/report-deadline"
import { REPORT_STATE } from "@/lib/shift-report"
import { WEEKDAY_SHORT, weekdayOf } from "@/lib/shifts"
import { wallInTz } from "@/lib/tz"
import { reader } from "@/lib/api/read"
import { STATUS } from "@opsdesk/domain/task-model"
import type { Person } from "@/lib/types"
import type { TaskStatus } from "@opsdesk/domain/task-model"
import type { DashboardDto } from "./dto-types"
import type {
  AttentionRow, ManagerAttentionData, ReportDeadlineCardData, StaffCommentsData, StaffEvidenceData, StaffMyTasksData, StaffTaskState, SummaryData, TaskProgressData, TasksClosedData, TeamTasksData, TodayData,
  TodayItem,
} from "./types"
import type { DeadlineRow } from "@/lib/report-deadline"
import type { DayGroup, TodayMode } from "@/lib/today"

const R = reader("dashboard")
const wall = (instant: string, tz: string): string => wallInTz(instant, tz).slice(0, 16)
const STATUSES = ["not_started", "in_progress", "blocked", "submitted", "changes_requested", "completed", "cancelled"] as const

export type DeadlineCtx = { tz: string; nowAt: string; tzLabel: string; dueAfterMinutes?: number }

/** The report deadline of a dashboard DTO (`reportDeadline`) as the card shows it. Undefined when there is nothing to show (no report, no due time) so the page leaves the card out. */
export function toDeadlineCard(dto: unknown, ctx: DeadlineCtx): ReportDeadlineCardData | undefined {
  const r = R.rec(dto, "reportDeadline")
  R.exact(r, ["member", "team"])
  const nowWall = wall(ctx.nowAt, ctx.tz)
  const note = `${ctx.tzLabel}${ctx.dueAfterMinutes === undefined ? "" : ` · shift end + ${ctx.dueAfterMinutes} min`}`
  const secs = (dueAt: string | null) => (dueAt === null ? 0 : Math.max(0, Math.round((Date.parse(dueAt) - Date.parse(ctx.nowAt)) / 1000)))
  if (r.team !== null && r.team !== undefined) {
    const t = R.rec(r.team, "team deadline")
    R.exact(t, ["open", "missing", "awaitingReview", "nextDueAt", "teams"])
    const nextDueAt = R.strOrNull(t, "nextDueAt")
    const rows: DeadlineRow[] = R.arr(t, "teams").map((v) => {
      const x = R.rec(v, "team row")
      R.exact(x, ["teamId", "team", "open", "missing", "nextDueAt"])
      const name = R.str(x, "team")
      const missing = R.int(x, "missing")
      const open = R.int(x, "open")
      const due = R.strOrNull(x, "nextDueAt")
      const q = new URLSearchParams({ team: name })
      if (missing) q.set("status", "missing")
      return {
        key: name,
        label: name,
        detail: `${open} open`,
        status: missing ? { tone: "bad", label: `${missing} missing` } : open && due ? { tone: "info", label: `Due ${formatTime(wall(due, ctx.tz))}` } : { tone: "ok", label: "All in" },
        href: `/daily-reports?${q.toString()}`,
      }
    })
    const dueWall = nextDueAt ? wall(nextDueAt, ctx.tz) : null
    if (!nextDueAt && rows.length === 0) return undefined
    return { kind: "team", title: "Shift report deadline", dueAt: dueWall, dueLabel: dueLabel(dueWall, nowWall), rows, missing: R.int(t, "missing"), note, seconds: secs(nextDueAt) }
  }
  if (r.member === null || r.member === undefined) return undefined
  const m = R.rec(r.member, "member deadline")
  R.exact(m, ["key", "shiftName", "shiftDate", "startAt", "endAt", "dueAt", "state", "reportId"])
  const dueAt = R.str(m, "dueAt")
  const endAt = R.str(m, "endAt")
  const reportId = R.strOrNull(m, "reportId")
  const given = R.str(m, "state")
  // the state at the page's clock, from instants: a draft past its due instant is Missing
  const state = given === "draft" && Date.parse(ctx.nowAt) > Date.parse(dueAt) ? "missing" : (given as keyof typeof REPORT_STATE)
  if (!(state in REPORT_STATE)) R.oneOf({ state }, "state", Object.keys(REPORT_STATE))
  const dueWall = wall(dueAt, ctx.tz)
  const inShift = Date.parse(ctx.nowAt) < Date.parse(endAt)
  const detail =
    state === "draft" ? `${inShift ? "In shift now" : "Shift ended"} · due ${formatTime(dueWall)}`
    : state === "missing" ? `Was due ${formatDue(dueWall, nowWall)}`
    : state === "returned" ? "Returned · change it and resubmit"
    : "Submitted"
  const key = R.str(m, "key")
  const row: DeadlineRow = { key, label: R.str(m, "shiftName"), detail, status: REPORT_STATE[state], href: `/daily-reports/${reportId ?? encodeURIComponent(key)}` }
  return { kind: "member", title: "My shift report", dueAt: dueWall, dueLabel: dueLabel(dueWall, nowWall), rows: [row], missing: state === "missing" ? 1 : 0, note, seconds: state === "draft" ? secs(dueAt) : 0 }
}

// ---- manager home ----

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0)

export type ManagerHome = {
  summary: SummaryData
  tasksClosed: TasksClosedData
  progress: TaskProgressData
  deadline?: ReportDeadlineCardData
  attentionCount: number | null
}

/** `GET /v1/dashboard`. */
export function toDashboard(dto: unknown, ctx: { tz: string; nowAt?: string; tzLabel?: string; dueAfterMinutes?: number }): ManagerHome {
  const r = R.rec(dto, "dashboard")
  R.exact(r, ["asOf", "day", "summary", "tasksClosed", "progress", "reportDeadline", "attentionCount"])
  const s = R.rec(r.summary, "summary")
  R.exact(s, ["open", "overdue", "dueToday", "completedToday", "trend", "awaitingReview", "evidencePending"])
  const p = R.rec(r.progress, "progress")
  R.exact(p, ["total", "percent", "mix"])
  const mix = R.rec(p.mix, "mix")
  const n = (k: string) => R.int(mix, k)
  const total = R.int(p, "total")
  const completed = n("completed")
  const inProgress = n("in_progress") + n("submitted") + n("changes_requested")
  const blocked = n("blocked")
  const deadline = toDeadlineCard(r.reportDeadline, { tz: ctx.tz, nowAt: ctx.nowAt ?? R.str(r, "asOf"), tzLabel: ctx.tzLabel ?? ctx.tz, ...(ctx.dueAfterMinutes === undefined ? {} : { dueAfterMinutes: ctx.dueAfterMinutes }) })
  const team = R.rec(r.reportDeadline, "reportDeadline").team
  const reportsCard =
    team && typeof team === "object"
      ? (() => {
          const t = team as Record<string, unknown>
          const missing = R.int(t, "missing")
          return [{
            title: "Shift Reports", icon: "report" as const, ariaLabel: "View shift reports", href: "/daily-reports", value: String(R.int(t, "awaitingReview")),
            note: missing > 0 ? { tone: "down" as const, highlight: `${missing} missing`, text: "" } : { text: "to review" },
          }]
        })()
      : []
  const trend = R.arr(s, "trend").map((v) => (Number.isInteger(v) ? (v as number) : (R.rec(null, "trend") as never)))
  const completedToday = R.int(s, "completedToday")
  const days = R.arr(R.rec(r.tasksClosed, "tasksClosed"), "days")
  return {
    summary: {
      stats: [
        { title: "Open Tasks", icon: "task", ariaLabel: "View open tasks", href: "/tasks?status=open", value: String(R.int(s, "open")), hero: true, note: { tone: "up", highlight: String(completedToday), text: " done today" }, trend },
        { title: "Overdue Tasks", icon: "clock", ariaLabel: "View overdue tasks", href: "/tasks?due=overdue", value: String(R.int(s, "overdue")), note: { tone: "down", highlight: `${blocked} blocked`, text: "" } },
        { title: "Awaiting Review", icon: "badge", ariaLabel: "View tasks awaiting review", href: "/tasks?status=submitted", value: String(R.int(s, "awaitingReview")), note: { text: "to approve" } },
        ...reportsCard,
      ],
    },
    tasksClosed: {
      title: "Tasks Closed",
      subtitle: "Last 7 days",
      days: days.map((v, i): TasksClosedData["days"][number] => {
        const x = R.rec(v, "day")
        R.exact(x, ["date", "count", "late", "topCloser"])
        const date = R.str(x, "date")
        const count = R.int(x, "count")
        const late = R.int(x, "late")
        const wd = weekdayOf(date)
        const tc = x.topCloser === null ? null : R.rec(x.topCloser, "topCloser")
        if (tc) R.exact(tc, ["userId", "name", "count"])
        return {
          d: WEEKDAY_SHORT[wd][0]!,
          n: count,
          on: count === 0 ? 100 : pct(count - late, count),
          t: i === days.length - 1 ? "today" : wd === 0 || wd === 6 ? "weekend" : i % 2 === 0 ? "s1" : "s2",
          date: formatDateYear(date),
          late,
          topCloser: tc ? { name: R.str(tc, "name"), count: R.int(tc, "count") } : null,
        }
      }),
    },
    progress: {
      title: "Task Progress",
      percent: R.int(p, "percent"),
      label: "Completed",
      ariaLabel: `${R.int(p, "percent")}% completed, ${inProgress} in progress, ${blocked} blocked`,
      legend: [
        { key: "solid", label: "Completed", count: completed },
        { key: "deep", label: "In progress", count: inProgress },
        { key: "striped", label: "Blocked", count: blocked },
      ],
      layers: [
        { to: 1, fill: "url(#gauge-stripes)" },
        { to: total > 0 ? (completed + inProgress) / total : 0, fill: "var(--brand-shade)" },
        { to: total > 0 ? completed / total : 0, fill: "var(--brand-2)" },
      ],
    },
    ...(deadline ? { deadline } : {}),
    attentionCount: R.intOrNull(r, "attentionCount"),
  }
}

// ---- team tasks ----

export function toTeamTasks(dto: unknown, ctx: { people: Person[]; tz: string; today: string }): TeamTasksData {
  const r = R.rec(dto, "team tasks")
  return {
    title: "Team Tasks",
    nextCursor: R.strOrNull(r, "nextCursor"),
    tasks: R.arr(r, "items").map((v) => {
      const x = R.rec(v, "team task")
      R.exact(x, ["id", "ref", "title", "assigneeId", "assignee", "dept", "priority", "dueAt", "due", "late", "status"])
      const who = ctx.people.find((p) => p.id === R.str(x, "assigneeId"))
      const name = R.str(x, "assignee")
      const priority = R.int(x, "priority")
      const status = R.oneOf(x, "status", STATUSES) as TaskStatus
      return {
        initials: who?.initials ?? initialsOf(name),
        avatar: who?.avatar ?? avatarFor(R.str(x, "assigneeId")),
        name,
        role: who?.role ?? "",
        task: R.str(x, "title"),
        ref: R.str(x, "ref"),
        dept: R.str(x, "dept"),
        priority: (priority >= 1 && priority <= 3 ? priority : 2) as 1 | 2 | 3,
        due: formatDue(wall(R.str(x, "dueAt"), ctx.tz), ctx.today),
        late: R.bool(x, "late"),
        status: STATUS[status],
      }
    }),
  }
}

// ---- attention (FR-M1-79) ----

const ATTENTION = {
  overdue: { kind: "red", icon: "clock", status: { tone: "bad", label: "Overdue" } },
  blocked: { kind: "amber", icon: "flag", status: { tone: "warn", label: "Blocked" } },
  evidence_review: { kind: "blue", icon: "folder", status: { tone: "info", label: "Evidence" } },
  report_missing: { kind: "red", icon: "report", status: { tone: "bad", label: "Missing report" } },
  report_returned: { kind: "amber", icon: "report", status: { tone: "warn", label: "Returned" } },
} as const

export function toAttention(dto: unknown): ManagerAttentionData & { nextCursor: string | null } {
  const r = R.rec(dto, "attention")
  return {
    title: "Needs attention",
    subtitle: "Overdue, blocked and waiting on you",
    total: R.int(r, "total"),
    nextCursor: R.strOrNull(r, "nextCursor"),
    items: R.arr(r, "items").map((v): AttentionRow => {
      const x = R.rec(v, "attention item")
      R.exact(x, ["kind", "ref", "taskId", "reportId", "reportKey", "title", "ownerId", "owner", "dueAt", "reason"])
      const kind = R.oneOf(x, "kind", Object.keys(ATTENTION) as (keyof typeof ATTENTION)[])
      const ref = R.strOrNull(x, "ref")
      const reportId = R.strOrNull(x, "reportId")
      const key = R.strOrNull(x, "reportKey")
      const href = ref ? `/tasks/${ref}` : reportId ? `/daily-reports/${reportId}` : key ? `/daily-reports/${encodeURIComponent(key)}` : "/daily-reports"
      return { ...ATTENTION[kind], title: R.str(x, "title"), by: R.str(x, "owner"), note: R.str(x, "reason"), href }
    }),
  }
}

// ---- staff home ----

const STAFF_STATS: StaffMyTasksData["stats"] = [
  { key: "open", title: "My open", ariaLabel: "View my open tasks", href: "/tasks?status=open", hero: true, note: "Assigned to you and not yet closed" },
  { key: "overdue", title: "Overdue / blocked", ariaLabel: "View my overdue and blocked tasks", href: "/tasks?status=stuck", note: "Past due or blocked, reason required" },
  { key: "review", title: "Awaiting review", ariaLabel: "View tasks awaiting review", href: "/tasks?status=submitted", note: "Evidence submitted, not yet approved" },
  { key: "returned", title: "Returned to me", ariaLabel: "View tasks returned to me", href: "/tasks?status=changes_requested", note: "Needs changes before approval" },
]
const stateOf = (status: TaskStatus): StaffTaskState => (status === "blocked" ? "blocked" : status === "submitted" ? "review" : status === "changes_requested" ? "returned" : "open")

export type StaffHome = { myTasks: StaffMyTasksData; evidence: StaffEvidenceData; comments: StaffCommentsData; reportDeadline: Record<string, unknown> }

/** `GET /v1/dashboard/staff`. The counts are the DTO's; the deadline card is built by the page with the org clock (toDeadlineCard on `reportDeadline`). */
export function toStaff(dto: unknown, ctx: { tz: string }): StaffHome {
  const r = R.rec(dto, "staff dashboard")
  R.exact(r, ["myTasks", "evidence", "comments", "reportDeadline"])
  const t = R.rec(r.myTasks, "myTasks")
  R.exact(t, ["open", "overdue", "review", "returned", "items"])
  const e = R.rec(r.evidence, "evidence")
  R.exact(e, ["awaitingReview", "returned"])
  return {
    myTasks: {
      title: "My tasks",
      subtitle: "Assigned to you, soonest due first",
      action: "View all",
      stats: STAFF_STATS,
      counts: { open: R.int(t, "open"), overdue: R.int(t, "overdue"), review: R.int(t, "review"), returned: R.int(t, "returned") },
      tasks: R.arr(t, "items").map((v) => {
        const x = R.rec(v, "my task")
        R.exact(x, ["id", "ref", "title", "priority", "status", "dueAt", "due", "late"])
        const status = R.oneOf(x, "status", STATUSES) as TaskStatus
        return { ref: R.str(x, "ref"), title: R.str(x, "title"), state: stateOf(status), due: wall(R.str(x, "dueAt"), ctx.tz), status: STATUS[status] }
      }),
    },
    evidence: {
      title: "Evidence",
      subtitle: "Awaiting review or returned to you",
      awaitingReview: R.int(e, "awaitingReview"),
      returned: R.arr(e, "returned").map((v) => {
        const x = R.rec(v, "returned evidence")
        R.exact(x, ["ref", "title", "reason"])
        return { ref: R.str(x, "ref"), title: R.str(x, "title"), reason: R.str(x, "reason") }
      }),
    },
    comments: {
      title: "Recent activity",
      subtitle: "Manager comments on your tasks",
      items: R.arr(r, "comments").map((v) => {
        const x = R.rec(v, "comment")
        R.exact(x, ["id", "taskId", "ref", "taskTitle", "authorId", "author", "text", "at"])
        return { ref: R.str(x, "ref"), title: R.str(x, "taskTitle"), kind: "comment" as const, by: R.str(x, "author"), text: R.str(x, "text"), at: wall(R.str(x, "at"), ctx.tz) }
      }),
    },
    reportDeadline: R.rec(r.reportDeadline, "reportDeadline"),
  }
}

// ---- Today ----

/** `GET /v1/today`. The day key is the SERVER's working day (H6); counts, order and the written summary are the server's. */
export function toToday(dto: unknown, ctx: { meId: string; subject?: string; tz: string; nowAt: string; now: string; tzLabel: string; mode: TodayMode }): TodayData {
  const r = R.rec(dto, "today")
  R.exact(r, ["counts", "workingDay", "order", "summary", "reports"], ["team"])
  const c = R.rec(r.counts, "counts")
  R.exact(c, ["overdue", "dueToday", "high", "review", "reports", "blocked"])
  const wd = R.rec(r.workingDay, "workingDay")
  R.exact(wd, ["key", "startsAt", "hasShift"])
  const s = R.rec(r.summary, "summary")
  R.exact(s, ["headline", "lines", "spoken"])
  const team = r.team === undefined ? undefined : R.rec(r.team, "team")
  if (team) R.exact(team, ["count", "items"])
  return {
    meId: ctx.meId,
    subject: ctx.subject ?? ctx.meId,
    tz: ctx.tz,
    day: { key: R.str(wd, "key"), startsAt: wall(R.str(wd, "startsAt"), ctx.tz), hasShift: R.bool(wd, "hasShift") },
    now: ctx.now,
    nowAt: ctx.nowAt,
    tzLabel: ctx.tzLabel,
    mode: ctx.mode,
    counts: { overdue: R.int(c, "overdue"), dueToday: R.int(c, "dueToday"), high: R.int(c, "high"), review: R.int(c, "review"), reports: R.int(c, "reports"), blocked: R.int(c, "blocked") },
    order: R.arr(r, "order").map((v): TodayItem => {
      const x = R.rec(v, "today item")
      R.exact(x, ["taskId", "ref", "title", "priority", "status", "dueAt", "due", "evidenceRequired", "project", "group", "reason"])
      const priority = R.int(x, "priority")
      return {
        task: {
          id: R.str(x, "taskId"), ref: R.str(x, "ref"), title: R.str(x, "title"), priority: (priority >= 1 && priority <= 3 ? priority : 2) as 1 | 2 | 3, status: R.str(x, "status"),
          due: wall(R.str(x, "dueAt"), ctx.tz), evidenceRequired: R.bool(x, "evidenceRequired"), project: R.str(x, "project"),
        },
        group: R.oneOf(x, "group", ["overdue", "high-today", "today"] as readonly DayGroup[]),
        reason: R.str(x, "reason"),
      }
    }),
    summary: {
      headline: R.str(s, "headline"),
      lines: R.arr(s, "lines").map((l) => {
        const x = R.rec(l, "line")
        return { ref: R.strOrNull(x, "ref"), text: R.str(x, "text") }
      }),
      spoken: R.str(s, "spoken"),
    },
    ...(team
      ? {
          team: {
            count: R.int(team, "count"),
            items: R.arr(team, "items").map((v) => {
              const x = R.rec(v, "team item")
              return { ref: R.str(x, "ref"), title: R.str(x, "title"), who: R.str(x, "who"), reason: R.str(x, "reason") }
            }),
          },
        }
      : {}),
    reports: R.int(r, "reports"),
  }
}

void formatDate
export type { DashboardDto }
