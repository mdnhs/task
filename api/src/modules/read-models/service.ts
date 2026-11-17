import { and, desc, eq, inArray } from "drizzle-orm"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { addDays, epochToWall, wallToEpoch } from "@opsdesk/domain/shifts"
import { DEFAULT_DAY_START, dayOrder, daySummary, teamOverdue, todayCounts, type DayMode, type TodayTask } from "@opsdesk/domain/today"
import { can } from "@opsdesk/domain/permissions"
import { AppError } from "../../core/errors"
import { taskEvidence, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { occurrencesBetween } from "../shifts"
import { buildInboxQuery, currentItem, inboxRange, virtualRows, type InboxFilter } from "../shift-reports"
import { assigneesOf, decodeCursor, encodeCursor, namesOf, wallOf } from "../tasks"
import { dayBounds, lastDays, localDay } from "./days"
import type { AttentionDto, AttentionItemDto, DashboardDto, ReportDeadlineDto, StaffDto, TeamTasksDto, TodayDto } from "./dto"
import {
  attentionCountsQuery, attentionQuery, awaitingReportsQuery, awaitingReviewQuery, dashboardSummaryQuery, myCommentsQuery, myCountsQuery, myOpenTasksQuery, openReportsQuery, pendingEvidenceQuery,
  tasksClosedQuery, teamOverdueQuery, teamTasksQuery,
} from "./queries"
import { freeText, type RmScope } from "./scope"

// The loaders: pure functions of (tx, scope) that read what the caller may see (D5 / F5) and shape it. Nothing here writes, and nothing here knows about the cache: the routes wrap them.

const ref = (n: number): string => `TSK-${n}`
const DAY_MS = 86_400_000
const CAP = 200 // per attention kind: the feed is bounded; `total` still counts everything
const REPORT_PAGE = 100
const zero = { open: 0, overdue: 0, dueToday: 0, awaitingReview: 0, notStarted: 0, inProgress: 0, blocked: 0, submitted: 0, changesRequested: 0, completed: 0, cancelled: 0 }

// ---------------------------------------------------------------- report alerts (missing, returned): shared by the attention feed, the dashboard and Today

type ReportAlert = { kind: "report_missing" | "report_returned"; reportId: string | null; key: string; userId: string; teamId: string; shiftName: string; shiftDate: string; dueAt: Date }

/**
 * Missing (draft past its due time, and shifts nobody opened) and returned reports of the LAST 7 tenant days (the inbox's default window) in the report scope (F5); `person` narrows (Today: the member's
 * own). Stored rows come from the inbox statement, virtual ones from the same engine as the inbox, so the counts equal the inbox's. Bounded to REPORT_PAGE per kind. No free text is read.
 */
export async function loadReportAlerts(tx: TenantTx, s: RmScope, o: { person?: string } = {}): Promise<ReportAlert[]> {
  const ctx = s.rctx
  if (!ctx) return []
  const range = inboxRange(s.now, s.tz, {})
  const f = (status: InboxFilter["status"]): InboxFilter => ({ ...range, status, person: o.person })
  const [missing, returned, virtual] = await Promise.all([
    buildInboxQuery(tx, ctx.tenantId, ctx, f("missing"), s.now, REPORT_PAGE),
    buildInboxQuery(tx, ctx.tenantId, ctx, f("returned"), s.now, REPORT_PAGE),
    virtualRows(tx, ctx, f("missing"), REPORT_PAGE),
  ])
  const stored = (kind: ReportAlert["kind"]) => (r: (typeof missing)[number]): ReportAlert => ({
    kind, reportId: r.id, key: `${r.userId}:${r.patternId}:${r.shiftDate}`, userId: r.userId!, teamId: r.teamId, shiftName: r.shiftName, shiftDate: r.shiftDate, dueAt: r.dueAt,
  })
  return [
    ...missing.map(stored("report_missing")),
    ...virtual.slice(0, REPORT_PAGE).map((v): ReportAlert => ({ kind: "report_missing", reportId: null, key: `${v.userId}:${v.patternId}:${v.date}`, userId: v.userId, teamId: v.teamId, shiftName: v.shiftName, shiftDate: v.date, dueAt: v.dueAt })),
    ...returned.map(stored("report_returned")),
  ]
}

// ---------------------------------------------------------------- attention (F17: derived only)

const RANK = { overdue: 0, blocked: 1, evidence_review: 2, report_missing: 3, report_returned: 4 } as const
type Ranked = AttentionItemDto & { _rank: number; _key: string }

function lateText(due: Date, now: Date): string {
  const ms = now.getTime() - due.getTime()
  const days = Math.floor(ms / DAY_MS)
  if (days >= 1) return `overdue by ${days} ${days === 1 ? "day" : "days"}`
  const hours = Math.floor(ms / 3_600_000)
  return hours >= 1 ? `overdue by ${hours} ${hours === 1 ? "hour" : "hours"}` : "overdue"
}
/** Code-unit comparison (never localeCompare: the cursor compares the same way). */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const upper = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/** The whole feed, sorted (kind order, then due, then id), at most CAP per task kind and REPORT_PAGE per report kind. `total` counts every item that exists. Cached by the route; cursor paging is over the sorted list. */
export async function loadAttention(tx: TenantTx, s: RmScope): Promise<{ total: number; items: Ranked[] }> {
  const free = freeText(s, withholdDriveText)
  const t = s.tctx
  const items: Ranked[] = []
  let total = 0
  const names: string[] = []
  type TaskRowOf = Awaited<ReturnType<typeof attentionQuery>>[number] & { pending?: number }
  const fromTasks = async (kind: "overdue" | "blocked" | "evidence_review", rows: TaskRowOf[]) => {
    const people = await assigneesOf(tx, s.tenantId, rows.map((r) => r.id)) // one batch for the page: the primary assignee is the owner
    for (const r of rows) {
      const owner = people.get(r.id)?.primary ?? r.creatorId
      if (owner) names.push(owner)
      const late = r.dueAt.getTime() < s.now.getTime()
      const reason =
        kind === "overdue" ? upper(lateText(r.dueAt, s.now))
        : kind === "blocked" ? `Blocked${late ? `, ${lateText(r.dueAt, s.now)}` : ""}`
        : `Waiting for review${r.pending ? `, ${r.pending} evidence ${r.pending === 1 ? "item" : "items"} pending` : ""}`
      items.push({ kind, ref: ref(r.refNo), taskId: r.id, reportId: null, reportKey: null, title: free(r.title), ownerId: owner, owner: "", dueAt: r.dueAt.toISOString(), reason, _rank: RANK[kind], _key: r.id })
    }
  }
  if (t) {
    const [counts] = await attentionCountsQuery(tx, t)
    total += counts.overdue + counts.blocked + counts.review
    if (counts.overdue) await fromTasks("overdue", await attentionQuery(tx, t, "overdue", CAP))
    if (counts.blocked) await fromTasks("blocked", await attentionQuery(tx, t, "blocked", CAP))
    if (counts.review) await fromTasks("evidence_review", await awaitingReviewQuery(tx, t, CAP))
  }
  const alerts = await loadReportAlerts(tx, s)
  total += alerts.length
  for (const a of alerts) {
    names.push(a.userId)
    items.push({
      kind: a.kind, ref: null, taskId: null, reportId: a.reportId, reportKey: a.key, title: free(`${a.shiftName}, ${a.shiftDate}`), ownerId: a.userId, owner: "", dueAt: a.dueAt.toISOString(),
      reason: a.kind === "report_missing" ? "Shift report not submitted" : "Shift report returned for changes", _rank: RANK[a.kind], _key: a.key,
    })
  }
  const nameOf = await namesOf(tx, names)
  for (const i of items) i.owner = i.ownerId ? nameOf(i.ownerId) : ""
  items.sort((a, b) => a._rank - b._rank || cmp(a.dueAt, b.dueAt) || cmp(a._key, b._key)) // code-unit order, the same the cursor filter uses
  return { total, items }
}

const cursorOf = (i: Ranked): string => Buffer.from(`${i._rank}|${i.dueAt}|${i._key}`, "utf8").toString("base64url")
function decodeAttentionCursor(raw: string): { rank: number; dueAt: string; key: string } {
  const [rank, dueAt, ...rest] = Buffer.from(raw, "base64url").toString("utf8").split("|")
  const key = rest.join("|")
  const r = Number(rank)
  if (!Number.isInteger(r) || r < 0 || r > 4 || !dueAt || Number.isNaN(Date.parse(dueAt)) || !key) throw new AppError(400, "invalid_cursor", "Bad Request")
  return { rank: r, dueAt, key }
}
/** One page of the sorted feed after the cursor. */
export function attentionPage(feed: { total: number; items: Ranked[] }, limit: number, cursor?: string): AttentionDto {
  let rest = feed.items
  if (cursor) {
    const c = decodeAttentionCursor(cursor)
    rest = feed.items.filter((i) => i._rank > c.rank || (i._rank === c.rank && (i.dueAt > c.dueAt || (i.dueAt === c.dueAt && i._key > c.key))))
  }
  const page = rest.slice(0, limit)
  const more = rest.length > limit
  return { items: page.map(({ _rank, _key, ...i }) => (void _rank, void _key, i)), total: feed.total, nextCursor: more && page.length ? cursorOf(rest[page.length - 1] as Ranked) : null }
}

// ---------------------------------------------------------------- the report deadline card

async function reportDeadline(tx: TenantTx, s: RmScope, alerts: ReportAlert[]): Promise<ReportDeadlineDto> {
  const ctx = s.rctx
  if (!ctx) return { member: null, team: null }
  const member = await currentItem(tx, ctx)
  if (ctx.access.kind === "own") return { member, team: null }
  const today = localDay(s.now, s.tz)
  const range = inboxRange(s.now, s.tz, {})
  const since = new Date(dayBounds(range.from, s.tz).start)
  const [open, [awaiting]] = await Promise.all([openReportsQuery(tx, ctx, since), awaitingReportsQuery(tx, ctx, addDays(today, -30), today)])
  const missingBy = new Map<string, number>()
  for (const a of alerts) if (a.kind === "report_missing") missingBy.set(a.teamId, (missingBy.get(a.teamId) ?? 0) + 1)
  const ids = [...new Set([...open.map((o) => o.teamId), ...missingBy.keys()])]
  const names = ids.length ? new Map((await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, ids)))).map((t) => [t.id, t.name])) : new Map<string, string>()
  const rows = ids.map((id) => {
    const o = open.find((x) => x.teamId === id)
    return { teamId: id, team: names.get(id) ?? "", open: o?.open ?? 0, missing: missingBy.get(id) ?? 0, nextDueAt: o?.nextDue ? new Date(o.nextDue).toISOString() : null }
  })
  const next = rows.flatMap((r) => (r.nextDueAt ? [r.nextDueAt] : [])).sort()[0] ?? null
  return {
    member,
    team: { open: rows.reduce((n, r) => n + r.open, 0), missing: rows.reduce((n, r) => n + r.missing, 0), awaitingReview: awaiting?.n ?? 0, nextDueAt: next, teams: rows.sort((a, b) => a.team.localeCompare(b.team)) },
  }
}

// ---------------------------------------------------------------- dashboard

export async function loadDashboard(tx: TenantTx, s: RmScope): Promise<DashboardDto> {
  const t = s.tctx
  const day = localDay(s.now, s.tz)
  const days = lastDays(day, 7)
  const sum = t ? ((await dashboardSummaryQuery(tx, t, day))[0] ?? zero) : { ...zero }
  const pending = t ? ((await pendingEvidenceQuery(tx, t))[0]?.n ?? 0) : 0
  const closedRows = t ? await tasksClosedQuery(tx, t, days) : []
  const by = days.map(() => ({ count: 0, late: 0, closers: new Map<string, number>() }))
  for (const r of closedRows) {
    const d = by[r.bucket - 1]
    if (!d) continue
    d.count += r.n
    d.late += r.late
    if (r.userId) d.closers.set(r.userId, (d.closers.get(r.userId) ?? 0) + r.n)
  }
  const closers = by.map((d) => [...d.closers.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] ?? null)
  const nameOf = await namesOf(tx, closers.flatMap((c) => (c ? [c[0]] : [])))
  const alerts = await loadReportAlerts(tx, s)
  let attentionCount: number | null = null
  if (s.attention) {
    const [c] = t ? await attentionCountsQuery(tx, t) : [{ overdue: 0, blocked: 0, review: 0 }]
    attentionCount = c.overdue + c.blocked + c.review + alerts.length
  }
  const trend = by.map((d) => d.count)
  const counted = sum.notStarted + sum.inProgress + sum.blocked + sum.submitted + sum.changesRequested + sum.completed + sum.cancelled
  const denom = counted - sum.cancelled
  return {
    asOf: s.now.toISOString(),
    day,
    summary: { open: sum.open, overdue: sum.overdue, dueToday: sum.dueToday, completedToday: trend[trend.length - 1], trend, awaitingReview: sum.awaitingReview, evidencePending: pending },
    tasksClosed: { days: days.map((date, i) => ({ date, count: by[i].count, late: by[i].late, topCloser: closers[i] ? { userId: closers[i]![0], name: nameOf(closers[i]![0]), count: closers[i]![1] } : null })) },
    progress: {
      total: counted,
      percent: denom > 0 ? Math.round((sum.completed / denom) * 100) : 0,
      mix: { not_started: sum.notStarted, in_progress: sum.inProgress, blocked: sum.blocked, submitted: sum.submitted, changes_requested: sum.changesRequested, completed: sum.completed, cancelled: sum.cancelled },
    },
    reportDeadline: await reportDeadline(tx, s, alerts),
    attentionCount,
  }
}

// ---------------------------------------------------------------- team tasks

export async function loadTeamTasks(tx: TenantTx, s: RmScope, q: { limit: number; cursor?: string }): Promise<TeamTasksDto> {
  const t = s.tctx
  if (!t) return { items: [], nextCursor: null }
  const free = freeText(s, withholdDriveText)
  const rows = await teamTasksQuery(tx, t, q.limit + 1, q.cursor ? decodeCursor(q.cursor) : undefined)
  const page = rows.slice(0, q.limit)
  const people = await assigneesOf(tx, t.tenantId, page.map((r) => r.id))
  const teamIds = [...new Set(page.flatMap((r) => (r.teamId ? [r.teamId] : [])))]
  const teamName = teamIds.length ? new Map((await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, t.tenantId), inArray(teams.id, teamIds)))).map((x) => [x.id, x.name])) : new Map<string, string>()
  const nameOf = await namesOf(tx, page.flatMap((r) => (people.get(r.id)?.primary ? [people.get(r.id)!.primary!] : [])))
  const last = page[page.length - 1]
  return {
    items: page.map((r) => {
      const primary = people.get(r.id)?.primary ?? ""
      return {
        id: r.id, ref: ref(r.refNo), title: free(r.title), assigneeId: primary, assignee: primary ? nameOf(primary) : "", dept: r.teamId ? (teamName.get(r.teamId) ?? "") : "", priority: r.priority,
        dueAt: r.dueAt.toISOString(), due: wallOf(r.dueAt, s.tz), late: r.dueAt.getTime() < s.now.getTime(), status: r.status as TeamTasksDto["items"][number]["status"],
      }
    }),
    nextCursor: rows.length > q.limit && last ? encodeCursor(last.dueAt, last.id) : null,
  }
}

// ---------------------------------------------------------------- the member's own (staff dashboard)

export async function loadStaff(tx: TenantTx, s: RmScope): Promise<StaffDto> {
  const free = freeText(s, withholdDriveText)
  const empty = { myTasks: { open: 0, overdue: 0, review: 0, returned: 0, items: [] }, evidence: { awaitingReview: 0, returned: [] }, comments: [] }
  const member = s.rctx ? await currentItem(tx, s.rctx) : null
  if (!s.tctx) return { ...empty, reportDeadline: { member, team: null } }
  const [counts] = await myCountsQuery(tx, s.tenantId, s.me, s.now)
  const rows = await myOpenTasksQuery(tx, s.tenantId, s.me, 50)
  const returned = rows.filter((r) => r.status === "changes_requested").slice(0, 20)
  const reasons = returned.length
    ? await tx.select({ taskId: taskEvidence.taskId, reason: taskEvidence.reason }).from(taskEvidence).where(and(eq(taskEvidence.tenantId, s.tenantId), inArray(taskEvidence.taskId, returned.map((r) => r.id)), eq(taskEvidence.review, "rejected"))).orderBy(desc(taskEvidence.reviewedAt), desc(taskEvidence.id))
    : []
  const reasonOf = new Map<string, string>()
  for (const r of reasons) if (!reasonOf.has(r.taskId)) reasonOf.set(r.taskId, r.reason ?? "")
  const comments = await myCommentsQuery(tx, s.tenantId, s.me, 10)
  const nameOf = await namesOf(tx, comments.flatMap((c) => (c.authorId ? [c.authorId] : [])))
  return {
    myTasks: {
      open: counts.open, overdue: counts.overdue, review: counts.review, returned: counts.returned,
      items: rows.map((r) => ({ id: r.id, ref: ref(r.refNo), title: free(r.title), priority: r.priority, status: r.status as StaffDto["myTasks"]["items"][number]["status"], dueAt: r.dueAt.toISOString(), due: wallOf(r.dueAt, s.tz), late: r.dueAt.getTime() < s.now.getTime() })),
    },
    evidence: { awaitingReview: counts.review, returned: returned.map((r) => ({ ref: ref(r.refNo), title: free(r.title), reason: free(reasonOf.get(r.id) || "Changes requested") })) },
    comments: comments.map((c) => ({ id: c.id, taskId: c.taskId, ref: ref(c.refNo), taskTitle: free(c.taskTitle), authorId: c.authorId, author: c.authorId ? nameOf(c.authorId) : "Former member", text: free(c.body), at: c.at.toISOString() })),
    reportDeadline: { member, team: null },
  }
}

// ---------------------------------------------------------------- Today

/** FR-M1-70: the running shift's start, else the latest shift started today (the member's own occurrences), else DEFAULT_DAY_START tenant time of the day (before it, the day before). Instants. */
async function workingDay(tx: TenantTx, s: RmScope): Promise<TodayDto["workingDay"]> {
  const today = localDay(s.now, s.tz)
  const t = s.now.getTime()
  const occ = (await occurrencesBetween(tx, s.tenantId, s.tz, addDays(today, -1), today, { userIds: [s.me] })).filter((o) => o.startAt.getTime() <= t)
  const running = occ.filter((o) => t < o.endAt.getTime()).sort((a, b) => b.startAt.getTime() - a.startAt.getTime())[0]
  const latest = running ?? occ.filter((o) => o.shiftDate === today).sort((a, b) => b.startAt.getTime() - a.startAt.getTime())[0]
  if (latest) return { key: latest.shiftDate, startsAt: latest.startAt.toISOString(), hasShift: true }
  const hhmm = epochToWall(t, s.tz).slice(11, 16)
  const key = hhmm < DEFAULT_DAY_START ? addDays(today, -1) : today
  return { key, startsAt: new Date(wallToEpoch(`${key}T${DEFAULT_DAY_START}:00`, s.tz)).toISOString(), hasShift: false }
}

export async function loadToday(tx: TenantTx, s: RmScope, mode: DayMode): Promise<TodayDto> {
  const free = freeText(s, withholdDriveText)
  const nowWall = wallOf(s.now, s.tz)
  const rows = s.tctx ? await myOpenTasksQuery(tx, s.tenantId, s.me, 300) : []
  const tasks: TodayTask[] = rows.map((r) => ({
    ref: ref(r.refNo), title: free(r.title), priority: r.priority as 1 | 2 | 3, due: wallOf(r.dueAt, s.tz), status: r.status, evidenceRequired: r.evidenceRule.mode === "required", project: free(r.client ?? r.teamName ?? ""),
  }))
  const idOf = new Map(rows.map((r) => [ref(r.refNo), r]))
  // reviewers (not staff-home roles with tasks access) see others' tasks waiting for review and the team's overdue line (FR-M1-79); staff see none of it
  const reviewer = !!s.tctx && s.role.home !== "staff" && can(s.role, "tasks")
  const review = reviewer ? (await attentionCountsQuery(tx, s.tctx!))[0].review : 0
  const alerts = await loadReportAlerts(tx, s, { person: s.me })
  const reports = alerts.length
  const counts = todayCounts(tasks, nowWall, { evidence: review, reports })
  const order = dayOrder(tasks, nowWall, mode)
  const summary = daySummary(tasks, nowWall, mode)
  let team: TodayDto["team"]
  if (reviewer) {
    const worst = await teamOverdueQuery(tx, s.tctx!, 3)
    const people = await assigneesOf(tx, s.tenantId, worst.map((w) => w.id))
    const nameOf = await namesOf(tx, worst.flatMap((w) => (people.get(w.id)?.primary ? [people.get(w.id)!.primary!] : [])))
    const asTasks = worst.map((w) => ({ ref: ref(w.refNo), title: free(w.title), priority: w.priority as 1 | 2 | 3, due: wallOf(w.dueAt, s.tz), status: w.status, evidenceRequired: false, project: "", assignee: people.get(w.id)?.primary ?? "" }))
    team = { ...teamOverdue(asTasks, s.me, nowWall, nameOf), count: worst[0]?.total ?? 0 }
  }
  return {
    counts,
    workingDay: await workingDay(tx, s),
    order: order.map((i) => {
      const r = idOf.get(i.task.ref)!
      return { taskId: r.id, ref: i.task.ref, title: i.task.title, priority: i.task.priority, status: i.task.status, dueAt: r.dueAt.toISOString(), due: i.task.due, evidenceRequired: i.task.evidenceRequired, project: i.task.project, group: i.group, reason: i.reason }
    }),
    summary: { headline: summary.headline, lines: summary.lines.slice(0, 101), spoken: summary.spoken.length > 8000 ? summary.lines.slice(0, 101).map((l) => l.text).join(" ") : summary.spoken },
    ...(team ? { team } : {}),
    reports,
  }
}


