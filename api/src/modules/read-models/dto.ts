import { z } from "@hono/zod-openapi"

const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const RID = "9b1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const UID = "usr_8Kq2mZ4tW1"
const UTC = "2026-11-20T17:00:00.000Z"
const WALL = "2026-11-20T17:00:00"
const STATUS = z.enum(["not_started", "in_progress", "blocked", "submitted", "changes_requested", "completed", "cancelled"])
const nullable = <T extends z.ZodType>(s: T) => s.nullable()

// ---------- dashboard ----------
const Summary = z.object({
  open: z.number().int(), overdue: z.number().int(), dueToday: z.number().int(), completedToday: z.number().int(), trend: z.array(z.number().int()), awaitingReview: z.number().int(), evidencePending: z.number().int(),
})
const ClosedDay = z.object({ date: z.string(), count: z.number().int(), late: z.number().int(), topCloser: nullable(z.object({ userId: z.string(), name: z.string(), count: z.number().int() })) })
const Progress = z.object({
  total: z.number().int(), percent: z.number().int().min(0).max(100),
  mix: z.object({ not_started: z.number().int(), in_progress: z.number().int(), blocked: z.number().int(), submitted: z.number().int(), changes_requested: z.number().int(), completed: z.number().int(), cancelled: z.number().int() }),
})
const MemberDeadline = z.object({ key: z.string(), shiftName: z.string(), shiftDate: z.string(), startAt: z.string(), endAt: z.string(), dueAt: z.string(), state: z.string(), reportId: nullable(z.string()) })
const TeamDeadline = z.object({
  open: z.number().int(), missing: z.number().int(), awaitingReview: z.number().int(), nextDueAt: nullable(z.string()),
  teams: z.array(z.object({ teamId: z.string(), team: z.string(), open: z.number().int(), missing: z.number().int(), nextDueAt: nullable(z.string()) })),
})
const ReportDeadline = z.object({ member: nullable(MemberDeadline), team: nullable(TeamDeadline) })
const MEMBER_EX = { key: `${UID}:${TID}:2026-11-19`, shiftName: "Night", shiftDate: "2026-11-19", startAt: "2026-11-19T22:00:00.000Z", endAt: "2026-11-20T06:00:00.000Z", dueAt: "2026-11-20T07:00:00.000Z", state: "draft", reportId: null }
const DEADLINE_EX = { member: MEMBER_EX, team: { open: 3, missing: 1, awaitingReview: 2, nextDueAt: "2026-11-20T07:00:00.000Z", teams: [{ teamId: TID, team: "Night team", open: 3, missing: 1, nextDueAt: "2026-11-20T07:00:00.000Z" }] } }

export const DashboardOut = z
  .object({ asOf: z.string(), day: z.string(), summary: Summary, tasksClosed: z.object({ days: z.array(ClosedDay) }), progress: Progress, reportDeadline: ReportDeadline, attentionCount: nullable(z.number().int()) })
  .openapi({
    example: {
      asOf: "2026-11-20T12:00:00.000Z", day: "2026-11-20",
      summary: { open: 42, overdue: 3, dueToday: 8, completedToday: 5, trend: [4, 6, 3, 7, 5, 2, 5], awaitingReview: 2, evidencePending: 4 },
      tasksClosed: { days: [{ date: "2026-11-20", count: 5, late: 1, topCloser: { userId: UID, name: "Ann Byrne", count: 2 } }] },
      progress: { total: 60, percent: 40, mix: { not_started: 10, in_progress: 12, blocked: 2, submitted: 2, changes_requested: 1, completed: 30, cancelled: 3 } },
      reportDeadline: DEADLINE_EX, attentionCount: 9,
    },
  })

export const TeamTasksQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(300).optional() })
const TeamTask = z.object({
  id: z.uuid(), ref: z.string(), title: z.string(), assigneeId: z.string(), assignee: z.string(), dept: z.string(), priority: z.number().int().min(1).max(3), dueAt: z.string(), due: z.string(), late: z.boolean(), status: STATUS,
})
export const TeamTasksOut = z
  .object({ items: z.array(TeamTask), nextCursor: nullable(z.string()) })
  .openapi({ example: { items: [{ id: TID, ref: "TSK-1001", title: "Check fire exits", assigneeId: UID, assignee: "Ann Byrne", dept: "Cleaning", priority: 2, dueAt: UTC, due: WALL, late: false, status: "in_progress" }], nextCursor: null } })

// ---------- staff ----------
const MyTask = z.object({ id: z.uuid(), ref: z.string(), title: z.string(), priority: z.number().int(), status: STATUS, dueAt: z.string(), due: z.string(), late: z.boolean() })
export const StaffOut = z
  .object({
    myTasks: z.object({ open: z.number().int(), overdue: z.number().int(), review: z.number().int(), returned: z.number().int(), items: z.array(MyTask) }),
    evidence: z.object({ awaitingReview: z.number().int(), returned: z.array(z.object({ ref: z.string(), title: z.string(), reason: z.string() })) }),
    comments: z.array(z.object({ id: z.uuid(), taskId: z.uuid(), ref: z.string(), taskTitle: z.string(), authorId: nullable(z.string()), author: z.string(), text: z.string(), at: z.string() })),
    reportDeadline: ReportDeadline,
  })
  .openapi({
    example: {
      myTasks: { open: 3, overdue: 1, review: 0, returned: 1, items: [{ id: TID, ref: "TSK-1001", title: "Check fire exits", priority: 2, status: "in_progress", dueAt: UTC, due: WALL, late: false }] },
      evidence: { awaitingReview: 0, returned: [{ ref: "TSK-1002", title: "Lock up", reason: "Photo is blurry" }] },
      comments: [{ id: RID, taskId: TID, ref: "TSK-1001", taskTitle: "Check fire exits", authorId: UID, author: "Ann Byrne", text: "Please add the photo", at: UTC }],
      reportDeadline: { member: MEMBER_EX, team: null },
    },
  })

// ---------- attention ----------
export const ATTENTION_KINDS = ["overdue", "blocked", "evidence_review", "report_missing", "report_returned", "roster_leave", "roster_change_request", "roster_open_shift", "roster_draft_week", "qualification_expiring", "roster_unconfirmed"] as const
const AttentionItem = z.object({
  kind: z.enum(ATTENTION_KINDS), ref: nullable(z.string()), taskId: nullable(z.string()), reportId: nullable(z.string()), reportKey: nullable(z.string()), rosterRef: nullable(z.string()).openapi({ description: "Roster items (B8): the id to open: a shift, change request, leave or week; for an expiring qualification the person" }), title: z.string(), ownerId: nullable(z.string()), owner: z.string(), dueAt: z.string(), reason: z.string(),
})
export const AttentionQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(300).optional() })
export const AttentionOut = z
  .object({ items: z.array(AttentionItem), total: z.number().int(), nextCursor: nullable(z.string()) })
  .openapi({
    example: {
      items: [{ kind: "overdue", ref: "TSK-1001", taskId: TID, reportId: null, reportKey: null, rosterRef: null, title: "Check fire exits", ownerId: UID, owner: "Ann Byrne", dueAt: UTC, reason: "Overdue by 2 days" }],
      total: 9, nextCursor: null,
    },
  })

// ---------- Today ----------
export const TodayQuery = z.object({ mode: z.enum(["all", "high-and-overdue"]).default("all") })
const DayItem = z.object({
  taskId: z.uuid(), ref: z.string(), title: z.string(), priority: z.number().int().min(1).max(3), status: z.string(), dueAt: z.string(), due: z.string(), evidenceRequired: z.boolean(), project: z.string(),
  group: z.enum(["overdue", "high-today", "today"]), reason: z.string(),
})
export const TodayOut = z
  .object({
    counts: z.object({ overdue: z.number().int(), dueToday: z.number().int(), high: z.number().int(), review: z.number().int(), reports: z.number().int(), blocked: z.number().int() }),
    workingDay: z.object({ key: z.string(), startsAt: z.string(), hasShift: z.boolean() }),
    order: z.array(DayItem),
    summary: z.object({ headline: z.string(), lines: z.array(z.object({ ref: nullable(z.string()), text: z.string() })), spoken: z.string() }),
    team: z.object({ count: z.number().int(), items: z.array(z.object({ ref: z.string(), title: z.string(), who: z.string(), reason: z.string() })) }).optional(),
    reports: z.number().int(),
    roster: z.number().int().optional().openapi({ description: "Upcoming shifts of the caller's own that are published and not confirmed yet (0 without the roster module)" }),
  })
  .openapi({
    example: {
      counts: { overdue: 1, dueToday: 2, high: 1, review: 0, reports: 1, blocked: 0 },
      workingDay: { key: "2026-11-20", startsAt: "2026-11-20T04:00:00.000Z", hasShift: false },
      order: [{ taskId: TID, ref: "TSK-1001", title: "Check fire exits", priority: 3, status: "in_progress", dueAt: UTC, due: WALL, evidenceRequired: false, project: "Cleaning", group: "overdue", reason: "overdue by 1 day; high priority" }],
      summary: { headline: "1 overdue", lines: [{ ref: null, text: "Today you have 1 overdue." }], spoken: "Today you have 1 overdue." },
      reports: 1, roster: 2,
    },
  })

export const TodayUpdateBody = z
  .object({ taskId: z.uuid(), action: z.enum(["done", "snooze"]), dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .openapi({ example: { taskId: TID, action: "done", dayKey: "2026-11-20" } })
export const TodayUpdateOut = z
  .object({ result: z.enum(["applied", "duplicate", "skipped_archived"]), status: STATUS, evidenceStillNeeded: z.boolean() })
  .openapi({ example: { result: "applied", status: "completed", evidenceStillNeeded: false } })

export type DashboardDto = z.infer<typeof DashboardOut>
export type TeamTasksDto = z.infer<typeof TeamTasksOut>
export type StaffDto = z.infer<typeof StaffOut>
export type AttentionDto = z.infer<typeof AttentionOut>
export type AttentionItemDto = z.infer<typeof AttentionItem>
export type TodayDto = z.infer<typeof TodayOut>
export type ReportDeadlineDto = z.infer<typeof ReportDeadline>
