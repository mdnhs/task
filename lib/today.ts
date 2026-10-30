import { daysBetween, formatDue, isOverdue } from "./dates"
import { addDays, currentShift, shiftsFor, wallToEpoch } from "./shifts"
import type { ShiftAssignment, ShiftPattern } from "./shifts"
import type { TaskUpdate } from "./task-inbox"

// Today card and "Play my day" (SRS FR-M1-70..81). Pure and server-safe: no React, no I/O, every function takes `now`.
// Times are tenant wall clock strings ("YYYY-MM-DDTHH:mm:ss"); `now` is the tenant's now (org.today on the server).

/** The part of a task the briefing needs (public/data/tasks/tasks.json shape). `project` is the task's client, else its team. */
export type TodayTask = {
  ref: string
  title: string
  priority: 1 | 2 | 3
  due: string
  status: string
  evidenceRequired: boolean
  project: string
}

/** Same set as features/tasks/lifecycle OPEN, so the counts match the filtered /tasks list they open. */
const OPEN = ["not_started", "in_progress", "blocked", "submitted", "changes_requested"]
export const isOpenTask = (t: Pick<TodayTask, "status">) => OPEN.includes(t.status)
/** Priority 3 is "High" in the tasks module (there is no separate urgent level). */
export const isHigh = (t: Pick<TodayTask, "priority">) => t.priority === 3
const isToday = (due: string, now: string) => daysBetween(due, now) === 0

export const PRIORITY_WORD: Record<1 | 2 | 3, string> = { 1: "low", 2: "medium", 3: "high" }

// ---------- counts (FR-M1-71) ----------

/**
 * Each count equals the /tasks list its tile opens (status=open plus the due / priority filter, status=review for reviews).
 * `review` = other people's tasks waiting for this person's evidence review; `reports` = shift reports waiting for their
 * review (shown on the team line, it opens the report inbox). Both 0 for people who do not review.
 */
export type TodayCounts = { overdue: number; dueToday: number; high: number; review: number; reports: number; blocked: number }
/** Anything worth opening the card for: drives the pulse dot on the compact entry. */
export const todayHasNews = (c: TodayCounts, team?: { overdue: { count: number }; missing: unknown[] }) =>
  c.overdue + c.dueToday + c.high + c.review + c.blocked > 0 || !!team && (team.overdue.count > 0 || team.missing.length > 0)
export type ReviewCounts = { evidence: number; reports: number }

export function todayCounts(tasks: TodayTask[], now: string, review: ReviewCounts = { evidence: 0, reports: 0 }): TodayCounts {
  const open = tasks.filter(isOpenTask)
  return {
    overdue: open.filter((t) => isOverdue(t.due, now)).length,
    dueToday: open.filter((t) => isToday(t.due, now)).length,
    high: open.filter(isHigh).length,
    review: review.evidence,
    reports: review.reports,
    blocked: open.filter((t) => t.status === "blocked").length,
  }
}

// ---------- order and summary (FR-M1-72, FR-M1-75) ----------

export type DayMode = "all" | "high-and-overdue"
export type DayGroup = "overdue" | "high-today" | "today"
export type DayItem = { task: TodayTask; group: DayGroup; reason: string }

const byPriorityThenDue = (a: TodayTask, b: TodayTask) => b.priority - a.priority || a.due.localeCompare(b.due) || a.ref.localeCompare(b.ref)
const byDue = (a: TodayTask, b: TodayTask) => a.due.localeCompare(b.due) || b.priority - a.priority || a.ref.localeCompare(b.ref)

function overdueText(due: string, now: string): string {
  const days = daysBetween(now, due)
  if (days <= 0) return `overdue since ${formatDue(due, now).replace(/^Today /, "").trim()} today`
  return days === 1 ? "overdue by 1 day" : `overdue by ${days} days`
}

function reasonFor(t: TodayTask, group: DayGroup, now: string): string {
  const bits: string[] = []
  if (group === "overdue") bits.push(overdueText(t.due, now))
  if (group === "high-today") bits.push(`high priority, due ${formatDue(t.due, now).toLowerCase()}`)
  if (group === "today") bits.push(`due ${formatDue(t.due, now).toLowerCase()}`)
  if (group === "overdue" && isHigh(t)) bits.push("high priority")
  if (t.status === "blocked") bits.push("blocked, so clear the blocker first")
  if (t.status === "changes_requested") bits.push("changes were requested")
  if (t.evidenceRequired) bits.push("evidence needed")
  return bits.join("; ")
}

/**
 * The order the day is read in (FR-M1-75): overdue first (highest priority, then earliest due), then high priority due today,
 * then the rest due today by due time. Tasks waiting on a reviewer ("submitted") and finished tasks are not the person's to do.
 * `high-and-overdue` drops the last group.
 */
export function dayOrder(tasks: TodayTask[], now: string, mode: DayMode = "all"): DayItem[] {
  const mine = tasks.filter((t) => isOpenTask(t) && t.status !== "submitted")
  const overdue = mine.filter((t) => isOverdue(t.due, now)).sort(byPriorityThenDue)
  const left = mine.filter((t) => !isOverdue(t.due, now) && isToday(t.due, now))
  const high = left.filter(isHigh).sort(byDue)
  const rest = left.filter((t) => !isHigh(t)).sort(byDue)
  const item = (group: DayGroup) => (task: TodayTask): DayItem => ({ task, group, reason: reasonFor(task, group, now) })
  return [...overdue.map(item("overdue")), ...high.map(item("high-today")), ...(mode === "all" ? rest.map(item("today")) : [])]
}

export type DaySummary = {
  /** One-line headline, e.g. "3 overdue and 2 due today". */
  headline: string
  /** Plain sentences, in play order, each with the task it is about (null for the intro/closing lines). */
  lines: { ref: string | null; text: string }[]
  /** The same text as one string, read aloud first by "Play my day". */
  spoken: string
}

const plural = (n: number, w: string) => `${n} ${w}`

/** Rules-based written summary (FR-M1-72; the AI add-on replaces it): overdue, then priority, then due time, with a reason each. */
export function daySummary(tasks: TodayTask[], now: string, mode: DayMode = "all"): DaySummary {
  const order = dayOrder(tasks, now, mode)
  const counts = todayCounts(tasks, now)
  const nOverdue = order.filter((i) => i.group === "overdue").length
  const nHigh = order.filter((i) => i.group === "high-today").length
  const nRest = order.filter((i) => i.group === "today").length
  if (!order.length) {
    const text = mode === "all" ? "Nothing is overdue or due today. A clear day." : "No overdue or high priority tasks for today."
    return { headline: "Nothing needs you first", lines: [{ ref: null, text }], spoken: text }
  }
  const parts = [nOverdue && `${plural(nOverdue, "overdue")}`, nHigh && `${plural(nHigh, "high priority due today")}`, nRest && `${plural(nRest, "more due today")}`].filter(Boolean)
  const headline = parts.join(", ").replace(/, ([^,]*)$/, " and $1")
  const lines: DaySummary["lines"] = [{ ref: null, text: `Today you have ${headline}.` }]
  if (counts.blocked) lines.push({ ref: null, text: `${plural(counts.blocked, counts.blocked === 1 ? "task is" : "tasks are")} blocked.` })
  order.forEach((i, n) => lines.push({ ref: i.task.ref, text: `${n + 1}. ${i.task.title}: ${i.reason}.` }))
  return { headline, lines, spoken: lines.map((l) => l.text).join(" ") }
}

/** What the player says for one task (FR-M1-73): title, priority, due time, project, and whether evidence is needed. */
export function taskSpeech(item: DayItem, position: number, total: number, now: string): string {
  const t = item.task
  const state = item.group === "overdue" ? "Overdue. " : ""
  const due = `Due ${formatDue(t.due, now).replace(/^Today /, "today at ")}.`
  const evidence = t.evidenceRequired ? "Evidence needed." : "No evidence needed."
  return `${state}Task ${position} of ${total}. ${t.title}. ${PRIORITY_WORD[t.priority]} priority. ${due} Project: ${t.project}. ${evidence}`
}

// ---------- working day (FR-M1-70) ----------

export type WorkingDay = {
  /** Identifies the working day; the Today card is dismissed per user and key. A night shift belongs to its start date. */
  key: string
  /** When the day started (shift start, else 04:00 tenant time). */
  startsAt: string
  hasShift: boolean
}

export const DEFAULT_DAY_START = "04:00"

/**
 * The working day `personId` is in at `now`: the latest shift that has started and whose day is not over (running now, or started
 * today), else the calendar day that began at 04:00 tenant time.
 */
export function workingDay(personId: string, now: string, patterns: ShiftPattern[], assignments: ShiftAssignment[], tz: string): WorkingDay {
  const date = now.slice(0, 10)
  const running = currentShift(personId, now, patterns, assignments, tz)
  if (running) return { key: running.window.date, startsAt: running.window.start, hasShift: true }
  const t = wallToEpoch(now, tz)
  const started = shiftsFor(personId, date, date, patterns, assignments, tz).filter((o) => wallToEpoch(o.window.start, tz) <= t)
  const latest = started.at(-1)
  if (latest) return { key: latest.window.date, startsAt: latest.window.start, hasShift: true }
  const key = now.slice(11, 16) < DEFAULT_DAY_START ? addDays(date, -1) : date
  return { key, startsAt: `${key}T${DEFAULT_DAY_START}:00`, hasShift: false }
}

// ---------- manager version (FR-M1-79) ----------

export type TeamOverdue = { count: number; items: { ref: string; title: string; who: string; reason: string }[] }

/** Overdue open tasks of other people, worst first (highest priority, then longest overdue). */
export function teamOverdue(tasks: (TodayTask & { assignee: string })[], meId: string, now: string, who: (id: string) => string, limit = 3): TeamOverdue {
  const rows = tasks.filter((t) => t.assignee !== meId && isOpenTask(t) && isOverdue(t.due, now)).sort(byPriorityThenDue)
  return {
    count: rows.length,
    items: rows.slice(0, limit).map((t) => ({ ref: t.ref, title: t.title, who: who(t.assignee), reason: overdueText(t.due, now) })),
  }
}

// ---------- persistence keys (shared by the card and Account → Notifications) ----------

export const TODAY_COOKIE_AUTO = "od-today-auto"
export const TODAY_COOKIE_DISMISSED = "od-today-dismissed"

/** What the home screen shows at first paint: the full card, or just the compact entry that reopens it. */
export type TodayMode = "card" | "chip"

/** Server and client agree on this from the two cookies, so the first paint and the skeleton match (no flash after dismissal). */
export function todayMode(autoCookie: string | undefined, dismissedCookie: string | undefined, userId: string, dayKey: string): TodayMode {
  // Closed by default: the full card opens on its own only when the user switched "Show automatically" on.
  if (autoCookie !== "1") return "chip"
  return dismissedCookie === dismissedValue(userId, dayKey) ? "chip" : "card"
}
export const dismissedValue = (userId: string, dayKey: string) => `${userId}|${dayKey}`

// ---------- player actions through the tasks hand-off (FR-M1-74, AC-M1-10) ----------

/** Timeline source of the Today card's changes. */
export const TODAY_SOURCE = "Today card"

/**
 * The task change for "Mark done" or "Snooze" in the player, queued on lib/task-inbox.ts so the tasks store applies it
 * (features/tasks/store.ts applyTaskUpdates). One id per task, action and working day, so pressing twice is a no-op.
 * Evidence-required tasks never come here: the card opens the task page instead (AC-M1-10).
 */
export function todayUpdate(action: "done" | "snooze", ref: string, tenantId: string, dayKey: string, by: string, now: string): TaskUpdate {
  return {
    id: `today:${dayKey}:${ref}:${action}`,
    tenantId,
    ref,
    itemStatus: "done",
    minutes: 0,
    note: "",
    at: now.slice(0, 16),
    by,
    source: TODAY_SOURCE,
    ...(action === "snooze" ? { snooze: true } : {}),
  }
}

/** Refs the person already marked done or snoozed from the card on this working day (from the queued updates). */
export function handledToday(updates: readonly TaskUpdate[], dayKey: string): { done: Set<string>; snoozed: Set<string> } {
  const done = new Set<string>()
  const snoozed = new Set<string>()
  const prefix = `today:${dayKey}:`
  for (const u of updates) if (u.source === TODAY_SOURCE && u.id.startsWith(prefix)) (u.snooze ? snoozed : done).add(u.ref)
  return { done, snoozed }
}
