import { startSweep } from "../../core/observability/sweep"
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm"
import { addDays, occurrenceInstants, wallToEpoch } from "@opsdesk/domain/shifts"
import { diffFields } from "@opsdesk/domain/task-history"
import type { RepeatRule } from "@opsdesk/domain/task-model"
import { nextOccurrences, repeatError } from "@opsdesk/domain/task-recurrence"
import type { ResolvedRole } from "../../core/context"
import { Forbidden } from "../../core/errors"
import { memberships, projects, roles, shiftAssignments, shiftPatterns, taskChecklistItems, taskCounters, tasks, tenants } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { tenantEntitlements } from "../entitlements/service"
import { withTenantAfterCommit } from "../notifications"
import { domainPattern, patternZone, shiftDatesBetween, type PatternRow } from "../shifts"
import { directReports, effectiveReportScope } from "../teams"
import type { TaskDto } from "./dto"
import { publishTaskEvent } from "./events"
import { writeHistory } from "./history"
import { changeRecipients, notifyTask, type TaskEnv } from "./notify"
import { allAssignees, assigneesOf, nextRefNo, replaceAssignees, type AssigneeSet } from "./repo"
import type { TaskCtx, TaskRow } from "./scope"
import { lockedTask, staleVersion, taskDetailDto, unprocessable } from "./service"
import { wallOf } from "./time"

// Recurring tasks (FR-M1-09, ruling D11).
//
// A series is an ordinary task with `repeat` set; its own due date is the first occurrence. The job `tasks.recurrence` (every 15 min) creates
// one instance per tenant-local calendar date, up to the tenant's local today. Exactly-once rests on three things, any of which is enough to
// stop a duplicate and which together also stop gaps in the ref numbers:
//   1. the unique key (tenant_id, series_id, occurrence_date) with INSERT ... ON CONFLICT DO NOTHING (the last line of defence);
//   2. the series row is locked FOR UPDATE, and the cursor and the existing instances are re-read UNDER that lock, so a concurrent run waits
//      and then finds nothing to do (no ref number is taken for a date that already exists);
//   3. the per-series cursor `repeat_cursor` (the last local date handled) moves to today in the same transaction.
// The key is the DATE, never the due instant, so the repeated 01:30 of the October clock change cannot create a second instance, and the due
// time is wallToEpoch(date + the series' local time of day), which takes the EARLIER instant of an ambiguous time and moves a gap time forward.
//
// `per_shift` (F15, D11): the same machinery, the same unique key and cursor, but the dates are the SHIFT START dates of the series' pattern that its
// PRIMARY assignee is assigned to (a pattern-local date, F2), "today" is today in the pattern's own zone (the instance exists from the shift's
// own midnight), and the instance runs from the shift's start instant to its end instant (occurrenceInstants, F3: a night is 9 h on 24 Oct 2026,
// 7 h on 27 Mar 2027; the key is the shift date, so the repeated hour cannot create a second instance). The series' own due day is its first
// occurrence, as for every other frequency. An archived pattern produces nothing; an assignment added for a date the cursor already passed is not
// back-filled (the cursor only moves forward, like an edited rule).

export const RECURRENCE_JOB = "tasks.recurrence"
export const SYSTEM_ACTOR = "system:recurrence"
/** Catch-up window (ruling D11): dates older than today − 7 are skipped and logged in the series history, so a re-enabled module cannot flood anyone. */
export const CATCH_UP_DAYS = 7

const FREQS = ["daily", "weekdays", "weekly", "monthly"] as const
const DAY_MS = 86_400_000
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const validDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d)
}
const safeCode = (e: unknown): string => {
  const c = e && typeof e === "object" ? ((e as { code?: unknown }).code ?? (e as { name?: unknown }).name) : undefined
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : "error"
}

// ---------- PUT /v1/tasks/{id}/repeat ----------

export type RepeatInput = { freq: string; days?: number[]; dayOfMonth?: number; until?: string; patternId?: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The rule as stored: only the fields its frequency uses, days unique and sorted. `per_shift` needs a `patternId` (the pattern is checked to be live by setRepeat); anything odd is 422 invalid_repeat. */
export function normaliseRepeat(input: RepeatInput, firstDueDay: string): RepeatRule {
  if (!(FREQS as readonly string[]).includes(input.freq) && input.freq !== "per_shift") throw unprocessable("invalid_repeat")
  const freq = input.freq as RepeatRule["freq"]
  const rule: RepeatRule = { freq }
  if (freq === "per_shift") {
    if (typeof input.patternId !== "string" || !UUID.test(input.patternId)) throw unprocessable("invalid_repeat")
    rule.patternId = input.patternId.toLowerCase()
  }
  if (freq === "weekly") {
    const days = [...new Set(input.days ?? [])].sort((a, b) => a - b)
    if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw unprocessable("invalid_repeat")
    rule.days = days
  }
  if (freq === "monthly") {
    if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth! < 1 || input.dayOfMonth! > 31) throw unprocessable("invalid_repeat")
    rule.dayOfMonth = input.dayOfMonth
  }
  if (input.until !== undefined) {
    if (!validDay(input.until)) throw unprocessable("invalid_repeat")
    rule.until = input.until
  }
  if (repeatError(rule, firstDueDay)) throw unprocessable("invalid_repeat")
  return rule
}

/**
 * Sets or clears (`rule: null`) the repetition of a task. Managers only (ruling D6); an instance or a subtask cannot itself repeat. The cursor
 * is pulled back to yesterday so a rule changed today is evaluated for today too (instances that already exist are never duplicated).
 */
export async function setRepeat(tx: TenantTx, env: TaskEnv, ctx: TaskCtx, id: string, input: { version: number; rule: RepeatInput | null }): Promise<TaskDto> {
  const { row, assignees, manage } = await lockedTask(tx, ctx, id)
  if (!manage) throw Forbidden("forbidden")
  staleVersion(row, input.version)
  if (row.seriesId || row.parentId) throw unprocessable("invalid_repeat")
  const rule = input.rule ? normaliseRepeat(input.rule, wallOf(row.dueAt, ctx.tz).slice(0, 10)) : null
  let ruleTz = ctx.tz // the zone "today" is read in: the tenant's, or the pattern's own for per_shift
  if (rule?.freq === "per_shift") {
    const [p] = await tx.select().from(shiftPatterns).where(and(eq(shiftPatterns.id, rule.patternId!), eq(shiftPatterns.tenantId, ctx.tenantId), isNull(shiftPatterns.archivedAt)))
    if (!p) throw unprocessable("invalid_repeat") // unknown, another tenant's or archived pattern
    ruleTz = patternZone(p, ctx.tz)
  }
  const changes = diffFields({ repeat: row.repeat }, { repeat: rule })
  if (changes.length === 0) return taskDetailDto(tx, ctx, row)
  const yesterday = addDays(wallOf(ctx.now, ruleTz).slice(0, 10), -1)
  // a newly set rule (cursor null, also after a removal) starts at yesterday: only today and later are produced, never stale back-instances of an overdue task
  const repeatCursor = rule === null ? null : row.repeatCursor && row.repeatCursor < yesterday ? row.repeatCursor : yesterday
  const [next] = await tx.update(tasks).set({ repeat: rule, repeatCursor, version: row.version + 1, updatedAt: ctx.now }).where(and(eq(tasks.id, row.id), eq(tasks.tenantId, ctx.tenantId))).returning()
  const recipients = changeRecipients(ctx, row, assignees)
  const historyId = await writeHistory(tx, ctx, row.id, { kind: "updated", text: "Updated Repeat", changes, notified: recipients })
  await notifyTask(tx, env, ctx, next, recipients, "Task updated")
  const dto = await taskDetailDto(tx, ctx, next)
  await publishTaskEvent(tx, ctx, { type: "task.updated", payload: { taskId: row.id, historyId, fields: ["repeat"] } })
  return dto
}

// ---------- the job ----------

/** The live series of a tenant (tasks_series_live_idx). Exported so the EXPLAIN test plans the exact statement. */
export function liveSeriesQuery(tx: TenantTx, tenantId: string) {
  return tx
    .select({ id: tasks.id, repeat: tasks.repeat, cursor: tasks.repeatCursor, dueAt: tasks.dueAt, projectId: tasks.projectId })
    .from(tasks)
    .where(and(eq(tasks.tenantId, tenantId), sql`${tasks.repeat} is not null`, sql`${tasks.archivedAt} is null`))
    .orderBy(asc(tasks.id))
}

type Plan = { dates: string[]; skipped: number }

/**
 * Which local dates a series still owes: the occurrences after max(cursor, its own due day), no further back than today − 7 (those are
 * counted in `skipped`), up to today. The series' own due day is never an instance (it IS the first occurrence).
 */
export function planOccurrences(rule: RepeatRule, cursor: string | null, dueDay: string, today: string): Plan {
  const from = cursor && cursor > dueDay ? cursor : dueDay
  const floor = addDays(today, -CATCH_UP_DAYS)
  return { dates: nextOccurrences(rule, from > floor ? from : floor, today), skipped: from < floor ? nextOccurrences(rule, from, floor).length : 0 }
}

/** The same plan for `per_shift`: the shift start dates of `pattern` the primary assignee works (`mine` = their assignments of it), same catch-up window, until and cursor rules. */
export function planShiftOccurrences(rule: RepeatRule, pattern: Pick<PatternRow, "days">, mine: { fromDate: string; untilDate: string | null }[], cursor: string | null, dueDay: string, today: string): Plan {
  const from = cursor && cursor > dueDay ? cursor : dueDay
  const floor = addDays(today, -CATCH_UP_DAYS)
  return { dates: shiftDatesBetween(pattern, mine, from > floor ? from : floor, today, rule.until), skipped: from < floor ? shiftDatesBetween(pattern, mine, from, floor, rule.until).length : 0 }
}

/**
 * Job `tasks.recurrence` (every 15 min in the worker, `{}`). Active tenants only (C14) that still have M1 and are not blocked for payment
 * (ruling C13: no new tasks while writes are refused); the others keep their data and resume from the cursor, within the 7-day window.
 * Time comes ONLY from deps.clock (ruling E3). One tenant or one series failing never stops the rest (ids and a safe code are logged).
 */
export async function runRecurrence(_data: unknown, deps: Deps): Promise<void> {
  const rows = await deps.db.select({ id: tenants.id, tz: tenants.timezone }).from(tenants).where(eq(tenants.status, "active")) // `tenants` has no RLS
  const sweep = startSweep(deps, RECURRENCE_JOB)
  try {
  for (const { id: tenantId, tz } of rows) {
    try {
      sweep.tenant()
      const now = deps.clock.now()
      const ent = await tenantEntitlements(deps.db, tenantId, now)
      if (!ent.allowed.includes("M1") || ent.billingState === "blocked") continue
      const today = wallOf(now, tz).slice(0, 10)
      const live = await withTenant(deps.db, tenantId, (tx) => liveSeriesQuery(tx, tenantId))
      const shiftIds = [...new Set(live.flatMap((s) => (s.repeat?.freq === "per_shift" && s.repeat.patternId && UUID.test(s.repeat.patternId) ? [s.repeat.patternId] : [])))]
      const patterns = new Map<string, PatternRow>(
        shiftIds.length ? (await withTenant(deps.db, tenantId, (tx) => tx.select().from(shiftPatterns).where(and(eq(shiftPatterns.tenantId, tenantId), inArray(shiftPatterns.id, shiftIds))))).map((p) => [p.id, p]) : [],
      )
      for (const s of live) {
        try {
          const rule = s.repeat!
          let seriesToday = today
          if (rule.freq === "per_shift") {
            const p = patterns.get(rule.patternId ?? "")
            if (!p || p.archivedAt) continue // an archived (or missing) pattern has no occurrences (F14)
            seriesToday = wallOf(now, patternZone(p, tz)).slice(0, 10) // "today" is the pattern's own date
          }
          if (s.cursor && s.cursor >= seriesToday) continue // already handled today: no lock, no write
          // per_shift: the dates need the assignments, so the unlocked pre-read cannot know; the counter is taken (once a day per series) and the locked re-read plans
          const needsRefs = rule.freq === "per_shift" || planOccurrences(rule, s.cursor, wallOf(s.dueAt, tz).slice(0, 10), seriesToday).dates.length > 0
          await materialiseSeries(deps, { tenantId, tz, now, today: seriesToday, seriesId: s.id, projectId: s.projectId, needsRefs })
        } catch (err) {
          deps.logger.error({ tenantId, seriesId: s.id, errCode: safeCode(err) }, "recurrence failed for a series")
        }
      }
      if (live.length > 0) await deps.readModelCache.bust(tenantId) // instances may have been created: every API instance drops this tenant's read models
    } catch (err) {
      deps.logger.error({ tenantId, errCode: safeCode(err) }, "recurrence failed for a tenant")
    }
  }
  } finally {
    sweep.done()
  }
}

type Run = { tenantId: string; tz: string; now: Date; today: string; seriesId: string; projectId: string | null; needsRefs: boolean }

/**
 * Who an instance may be assigned to (ruling E2): the series' assignees that are still ACTIVE members and, when the series creator is a
 * team-scope manager, only themself or their CURRENT direct reports (a report that moved is dropped). A staff or all-scope creator adds no
 * limit (staff cannot assign others at all, so a staff-created series had its assignees set by a manager). If the primary is dropped the
 * first remaining person becomes primary; nobody left → null (the date is skipped and logged).
 */
async function instanceAssignees(tx: TenantTx, tenantId: string, creatorId: string | null, people: AssigneeSet): Promise<AssigneeSet | null> {
  const all = allAssignees(people)
  if (all.length === 0) return null
  const active = new Set((await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), inArray(memberships.userId, all)))).map((r) => r.u))
  let allowed: Set<string> | null = null
  if (creatorId) {
    const [c] = await tx.select({ id: roles.id, key: roles.key, home: roles.home }).from(memberships).innerJoin(roles, eq(roles.id, memberships.roleId)).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, creatorId)))
    if (c?.home === "manager" && (await effectiveReportScope(tx, tenantId, { id: c.id, key: c.key } as ResolvedRole)) === "team") allowed = new Set([creatorId, ...(await directReports(tx, creatorId))])
  }
  const keep = all.filter((u) => active.has(u) && (!allowed || allowed.has(u)))
  if (keep.length === 0) return null
  const primary = people.primary && keep.includes(people.primary) ? people.primary : keep[0]
  return { primary, others: keep.filter((u) => u !== primary).sort() }
}

/**
 * One series, one transaction. Lock order (the B4 rule): the ref counter row, then the project row FOR SHARE, then the series row FOR UPDATE,
 * then writes, history, notifications, and the events LAST. The counter is taken only when the unlocked pre-read saw dates to create; if the
 * locked re-read finds dates the pre-read did not (the rule was edited meanwhile) the run leaves the series for the next tick instead of
 * taking the counter out of order. A series whose project changed or that was archived, cleared or purged since the pre-read is left alone.
 */
async function materialiseSeries(deps: Deps, r: Run): Promise<void> {
  await withTenantAfterCommit(deps, r.tenantId, async (tx, enqueue) => {
    const { tenantId, tz, now, today } = r
    if (r.needsRefs) {
      await tx.insert(taskCounters).values({ tenantId }).onConflictDoNothing() // the counter row may not exist yet
      await tx.update(taskCounters).set({ nextNo: sql`${taskCounters.nextNo}` }).where(eq(taskCounters.tenantId, tenantId)) // take its row lock (held to commit)
    }
    if (r.projectId) await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, r.projectId))).for("share", { of: [projects] })
    const [s] = await tx.select().from(tasks).where(and(eq(tasks.id, r.seriesId), eq(tasks.tenantId, tenantId), sql`${tasks.repeat} is not null`, sql`${tasks.archivedAt} is null`)).for("update")
    if (!s || s.projectId !== r.projectId) return
    if (s.repeatCursor && s.repeatCursor >= today) return // a concurrent run already handled today (re-read under the lock)
    const rule = s.repeat!
    const dueDay = wallOf(s.dueAt, tz).slice(0, 10)
    let plan: Plan
    let shift: { pattern: PatternRow; primary: string | null } | null = null
    if (rule.freq === "per_shift") {
      const [pattern] = await tx.select().from(shiftPatterns).where(and(eq(shiftPatterns.id, rule.patternId ?? ""), eq(shiftPatterns.tenantId, tenantId), isNull(shiftPatterns.archivedAt)))
      if (!pattern) return // archived since the pre-read: nothing to produce
      const primary = (await assigneesOf(tx, tenantId, [s.id])).get(s.id)?.primary ?? null
      const mine = primary ? await tx.select({ fromDate: shiftAssignments.fromDate, untilDate: shiftAssignments.untilDate }).from(shiftAssignments).where(and(eq(shiftAssignments.tenantId, tenantId), eq(shiftAssignments.userId, primary), eq(shiftAssignments.patternId, pattern.id))) : []
      plan = planShiftOccurrences(rule, pattern, mine, s.repeatCursor, dueDay, today)
      shift = { pattern, primary }
    } else plan = planOccurrences(rule, s.repeatCursor, dueDay, today)
    if (plan.dates.length > 0 && !r.needsRefs) return

    const created: TaskRow[] = []
    let noAssignee = 0
    if (plan.dates.length > 0) {
      const have = new Set((await tx.select({ d: tasks.occurrenceDate }).from(tasks).where(and(eq(tasks.tenantId, tenantId), eq(tasks.seriesId, s.id), inArray(tasks.occurrenceDate, plan.dates)))).map((x) => x.d))
      const people = (await assigneesOf(tx, tenantId, [s.id])).get(s.id)!
      const assign = await instanceAssignees(tx, tenantId, s.creatorId, people)
      const items = await tx.select({ text: taskChecklistItems.text, position: taskChecklistItems.position }).from(taskChecklistItems).where(and(eq(taskChecklistItems.tenantId, tenantId), eq(taskChecklistItems.taskId, s.id))).orderBy(asc(taskChecklistItems.position), asc(taskChecklistItems.id))
      const startWall = wallOf(s.startAt, tz)
      const dueTime = wallOf(s.dueAt, tz).slice(11, 19)
      const lead = Math.max(0, dayNum(dueDay) - dayNum(startWall.slice(0, 10)))
      for (const date of plan.dates) {
        if (have.has(date)) continue
        if (!assign || (shift && assign.primary !== shift.primary)) {
          noAssignee++ // per_shift: the shifts are the primary assignee's, so instances are produced only while that person is still an active assignee
          continue
        }
        // per_shift: the shift's own start and end instants (F3); otherwise the series' local time of day on the date
        const win = shift ? occurrenceInstants(domainPattern(shift.pattern), date, tz) : null
        const dueAt = new Date(win ? win.endAt : wallToEpoch(`${date}T${dueTime}`, tz))
        const startAt = new Date(win ? win.startAt : Math.min(wallToEpoch(`${addDays(date, -lead)}T${startWall.slice(11, 19)}`, tz), dueAt.getTime()))
        const refNo = await nextRefNo(tx, tenantId)
        const [row] = await tx
          .insert(tasks)
          .values({
            tenantId, refNo, title: s.title, description: s.description, teamId: s.teamId, creatorId: s.creatorId, priority: s.priority, startAt, dueAt, labels: s.labels,
            estimateMin: s.estimateMin, client: s.client, projectId: s.projectId, milestoneId: s.milestoneId, evidenceRule: s.evidenceRule, seriesId: s.id, occurrenceDate: date,
            // The voice note is shared across the series (ruling D21): the instance points at the series' file. voice.ts replaces and clears it under the purge lock and
            // deletes the file only with its last reference (see the argument there); templates never reach this path.
            voiceFileId: s.voiceFileId, voiceMeta: s.voiceMeta, createdAt: now, updatedAt: now,
          })
          .onConflictDoNothing({ target: [tasks.tenantId, tasks.seriesId, tasks.occurrenceDate] })
          .returning()
        if (!row) continue // a duplicate the key refused: nothing was created
        await replaceAssignees(tx, tenantId, row.id, assign.primary!, assign.others)
        if (items.length) await tx.insert(taskChecklistItems).values(items.map((i) => ({ tenantId, taskId: row.id, text: i.text, position: i.position }))) // the checklist comes back unticked
        created.push(row)
        const recipients = [assign.primary!, ...assign.others].sort()
        await writeHistory(tx, { tenantId, actorId: SYSTEM_ACTOR, now }, row.id, { kind: "created", text: "Created from a recurring task", causeTaskId: s.id, notified: recipients })
        await notifyTask(tx, { deps, enqueue }, { tenantId }, row, recipients, "New task")
      }
    }
    await tx.update(tasks).set({ repeatCursor: today }).where(and(eq(tasks.id, s.id), eq(tasks.tenantId, tenantId))) // internal bookkeeping: no version bump
    const system = { tenantId, actorId: SYSTEM_ACTOR, now }
    if (plan.skipped > 0) await writeHistory(tx, system, s.id, { kind: "recurrence", text: `${plural(plan.skipped, "occurrence", "occurrences")} skipped (outside catch-up window)` })
    if (noAssignee > 0) await writeHistory(tx, system, s.id, { kind: "recurrence", text: `${plural(noAssignee, "occurrence", "occurrences")} skipped (no active assignee)` })
    for (const row of created) await publishTaskEvent(tx, system, { type: "task.created", payload: { taskId: row.id, parentId: null, projectId: row.projectId, seriesId: s.id } })
  })
}
