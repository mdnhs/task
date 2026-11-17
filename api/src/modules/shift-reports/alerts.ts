import { and, eq, gte, inArray, isNotNull, lte } from "drizzle-orm"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { addDays, dueInstant, epochToWall } from "@opsdesk/domain/shifts"
import { memberships, roles, shiftReportAlerts, shiftReports, tenants } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { tenantEntitlements } from "../entitlements/service"
import { notify, SUBJECT_TOKEN, withTenantAfterCommit } from "../notifications"
import { livePatternsQuery, loadReportingMaps, occurrencesBetween, patternZone, reportDueAfterMinutes, reportingFrom, type Occurrence } from "../shifts"
import { activePrimaryManager } from "../teams"
import { publishReportEvent } from "./events"

// The deadline job (FR-M1-30, ruling F12): "a shift report is due" when the shift has ended and "a shift report is missing" when the due time passed with nothing submitted.
//
// Job `shift-reports.deadline` (every 5 min in the worker, `{}`). Active tenants only (C14) that still have M1 and are not blocked for payment (C13); the others keep their data and
// are not alerted for what they missed while skipped beyond the 48 h window below. Time comes ONLY from deps.clock. One tenant, and inside it one member, failing never stops the rest
// (ids and a safe code are logged); a retryable conflict (40P01, 40001) is simply "try again next tick": nothing was written.
//
// Which shifts: the shift START dates (F2) from today - 5 to today + 1 (pattern zones can be a day ahead of the tenant's; a night is up to 24 h long and the due time up to 24 h after
// its end, so a due time inside the 48 h window can belong to a shift that started 4 days ago) → `occurrencesBetween` (assigned, active member, live pattern; instants from the domain
// engine, the repeated hour takes the earlier instant, F3). A report row that exists (the member opened it) keeps ITS stored end and due instants (F3); a shift nobody saved is due
// `end + reportDueAfterMinutes` real minutes (setting, default from the data file, F13). Effective reporting (member override ?? team default ?? off, T5.1) is read now.
//   prompt : end <= now < due, and no submission yet
//   missing: due <= now, due > now - 48 h, and no report with `first_submitted_at` (a returned report was submitted: never missing)
//   a due time more than 48 h old is NOT alerted (an outage must not turn into a flood); it is counted in a debug log, and the inbox still shows it as missing.
// A report submitted AFTER the alert does not retract it, but the ledger makes sure nothing repeats.
//
// Exactly once: the ledger `shift_report_alerts` has a unique key (tenant, member, pattern, shift date, kind). One transaction per (tenant, member) inserts the ledger rows
// `ON CONFLICT DO NOTHING RETURNING` and, ONLY for the rows that came back, writes the notifications and the event in the same transaction. A second worker, a retry, a restart or the
// repeated hour of the October change inserts nothing and so sends nothing; a failure rolls the ledger rows back with the notifications, so an alert is never half sent. The ledger insert
// is the arbiter (no advisory lock): rows are inserted in one global order ((shift date, pattern, kind) per member), so two workers wait for each other at the unique index but never
// deadlock; the event publish takes the relay-hint lock, so it comes LAST. Lock order: ledger rows → notifications → event.
//
// Who is told: the member (the prompt and the missing alert); for "missing" also the member's ACTIVE primary manager (the name is not stored: the body carries {{subject}}), or, when
// there is none (or the manager is suspended or gone), the active holders of the owner role (never the member twice). Nobody inactive, suspended or erased, nobody whose reporting is off.
// Text: shift name (Drive-redacted, E13), date and time only, never report content.

export const DEADLINE_JOB = "shift-reports.deadline"
/** A due time older than this is not alerted any more (ruling F12). */
export const LOOKBACK_MS = 48 * 3_600_000
/** The actor of the events this job publishes. */
export const DEADLINE_ACTOR = "system:report-deadline"
const SPAN_BEFORE = 5 // shift start dates looked at: today - 5 ...
const SPAN_AFTER = 1 // ... today + 1 (see above)

const RETRYABLE = new Set(["40P01", "40001"])
/** A code that is safe to log (never a message: it may hold a name or a SQL fragment). */
const safeCode = (e: unknown): string => {
  const o = e && typeof e === "object" ? (e as { code?: unknown; name?: unknown; cause?: unknown }) : {}
  const cause = o.cause && typeof o.cause === "object" ? (o.cause as { code?: unknown }).code : undefined
  const c = cause ?? o.code ?? o.name
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : "error"
}

type Kind = "prompt" | "missing"
type Pending = { occ: Occurrence; kind: Kind; dueAt: Date; zone: string }

const keyOf = (userId: string, patternId: string, date: string): string => `${userId}|${patternId}|${date}`
const hhmm = (ms: number, zone: string): string => epochToWall(ms, zone).slice(11, 16)

/** The one global order the ledger rows of a member are inserted in (see above). */
const order = (a: Pending, b: Pending): number => (a.occ.shiftDate < b.occ.shiftDate ? -1 : a.occ.shiftDate > b.occ.shiftDate ? 1 : a.occ.patternId < b.occ.patternId ? -1 : a.occ.patternId > b.occ.patternId ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0)

export async function runDeadlineJob(_data: unknown, deps: Deps): Promise<void> {
  const rows = await deps.db.select({ id: tenants.id, tz: tenants.timezone }).from(tenants).where(eq(tenants.status, "active")) // `tenants` has no RLS
  for (const { id: tenantId, tz } of rows) {
    try {
      const now = deps.clock.now()
      const ent = await tenantEntitlements(deps.db, tenantId, now)
      if (!ent.allowed.includes("M1") || ent.billingState === "blocked") continue
      await alertTenant(deps, tenantId, tz, now)
    } catch (err) {
      deps.logger.error({ tenantId, errCode: safeCode(err) }, "report deadline job failed for a tenant")
    }
  }
}

/** What is still owed in one tenant: the shifts that need an alert now and have no ledger row yet, per member. */
async function plan(deps: Deps, tenantId: string, tz: string, now: Date): Promise<Map<string, Pending[]>> {
  return withTenant(deps.db, tenantId, async (tx) => {
    const today = epochToWall(now.getTime(), tz).slice(0, 10)
    const from = addDays(today, -SPAN_BEFORE)
    const to = addDays(today, SPAN_AFTER)
    const occ = await occurrencesBetween(tx, tenantId, tz, from, to)
    const out = new Map<string, Pending[]>()
    if (occ.length === 0) return out
    const nowMs = now.getTime()
    const dueAfter = await reportDueAfterMinutes(tx, tenantId)
    const maps = await loadReportingMaps(tx, tenantId)
    const patterns = await livePatternsQuery(tx, tenantId)
    const stored = await tx
      .select({ userId: shiftReports.userId, patternId: shiftReports.patternId, shiftDate: shiftReports.shiftDate, endAt: shiftReports.endAt, dueAt: shiftReports.dueAt, first: shiftReports.firstSubmittedAt })
      .from(shiftReports)
      .where(and(eq(shiftReports.tenantId, tenantId), gte(shiftReports.shiftDate, from), lte(shiftReports.shiftDate, to), isNotNull(shiftReports.userId)))
    const done = await tx
      .select({ userId: shiftReportAlerts.userId, patternId: shiftReportAlerts.patternId, shiftDate: shiftReportAlerts.shiftDate, kind: shiftReportAlerts.kind })
      .from(shiftReportAlerts)
      .where(and(eq(shiftReportAlerts.tenantId, tenantId), gte(shiftReportAlerts.shiftDate, from), lte(shiftReportAlerts.shiftDate, to)))
    const zones = new Map(patterns.map((p) => [p.id, patternZone(p, tz)]))
    const reports = new Map(stored.map((r) => [keyOf(r.userId!, r.patternId, r.shiftDate), r]))
    const alerted = new Set(done.map((r) => `${keyOf(r.userId, r.patternId, r.shiftDate)}|${r.kind}`))
    let outside = 0
    for (const o of occ) {
      if (!reportingFrom(maps, o.userId, o.teamId)) continue // reporting is read now: off after the shift ended sends nothing
      const rep = reports.get(keyOf(o.userId, o.patternId, o.shiftDate))
      if (rep?.first) continue // submitted (even if returned since): never due, never missing
      const endMs = (rep?.endAt ?? o.endAt).getTime()
      const dueMs = rep?.dueAt.getTime() ?? dueInstant(o.endAt.getTime(), dueAfter) // a saved report keeps its own snapshot (F3)
      if (endMs > nowMs) continue // the shift has not ended
      const kind: Kind | null = nowMs < dueMs ? "prompt" : dueMs > nowMs - LOOKBACK_MS ? "missing" : null
      if (!kind) {
        outside++
        continue
      }
      if (alerted.has(`${keyOf(o.userId, o.patternId, o.shiftDate)}|${kind}`)) continue // already sent: no transaction needed (the unique key is still the arbiter)
      const list = out.get(o.userId) ?? []
      list.push({ occ: o, kind, dueAt: new Date(dueMs), zone: zones.get(o.patternId) ?? tz })
      out.set(o.userId, list)
    }
    if (outside > 0) deps.logger.debug({ tenantId, count: outside }, "missed report deadlines older than 48 h are not alerted")
    return out
  })
}

async function alertTenant(deps: Deps, tenantId: string, tz: string, now: Date): Promise<void> {
  const owed = await plan(deps, tenantId, tz, now)
  for (const [userId, list] of [...owed].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    try {
      await alertMember(deps, tenantId, userId, list.sort(order), now)
    } catch (err) {
      const code = safeCode(err)
      // a deadlock or serialisation conflict wrote nothing: the next tick does it (ids and a safe code only)
      deps.logger.error({ tenantId, errCode: code, retry: RETRYABLE.has(code) }, "report deadline alert failed for a member")
    }
  }
}

/** The active holders of the owner role, minus `except`. */
async function activeOwners(tx: TenantTx, tenantId: string, except: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(roles, and(eq(roles.id, memberships.roleId), eq(roles.tenantId, memberships.tenantId)))
    .where(and(eq(memberships.tenantId, tenantId), eq(roles.key, "owner"), eq(memberships.status, "active")))
    .orderBy(memberships.userId)
  return rows.map((r) => r.userId).filter((u) => u !== except)
}

/** One transaction for one member: ledger rows, then (only for the rows that were inserted) the notifications, then the events. */
async function alertMember(deps: Deps, tenantId: string, userId: string, list: Pending[], now: Date): Promise<void> {
  await withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    // the state may have moved since the plan: the member must still be active and a report submitted meanwhile means no alert
    const [m] = await tx.select({ status: memberships.status }).from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    if (m?.status !== "active") return
    const dates = [...new Set(list.map((p) => p.occ.shiftDate))]
    const subs = await tx
      .select({ patternId: shiftReports.patternId, shiftDate: shiftReports.shiftDate })
      .from(shiftReports)
      .where(and(eq(shiftReports.tenantId, tenantId), eq(shiftReports.userId, userId), inArray(shiftReports.shiftDate, dates), isNotNull(shiftReports.firstSubmittedAt)))
    const submitted = new Set(subs.map((s) => `${s.patternId}|${s.shiftDate}`))
    const sent: Pending[] = []
    for (const p of list) {
      if (submitted.has(`${p.occ.patternId}|${p.occ.shiftDate}`)) continue
      const [row] = await tx
        .insert(shiftReportAlerts)
        .values({ tenantId, userId, patternId: p.occ.patternId, shiftDate: p.occ.shiftDate, kind: p.kind, alertedAt: now })
        .onConflictDoNothing()
        .returning({ id: shiftReportAlerts.id })
      if (row) sent.push(p) // no row back: another worker (or an earlier tick) already sent it, so send nothing
    }
    if (sent.length === 0) return
    const missing = sent.filter((p) => p.kind === "missing")
    let recipients: string[] = []
    if (missing.length) {
      const manager = await activePrimaryManager(tx, tenantId, userId)
      recipients = manager && manager !== userId ? [manager] : await activeOwners(tx, tenantId, userId)
    }
    for (const p of sent) {
      const what = `${withholdDriveText(p.occ.name)}, ${p.occ.shiftDate}`
      if (p.kind === "prompt") {
        await notify(tx, tenantId, { userId, kind: "report", title: "Shift report due", body: `${what}. Due ${hhmm(p.dueAt.getTime(), p.zone)}`, link: "/reports" }, deps, enqueue)
        continue
      }
      const body = `${what}. Was due ${hhmm(p.dueAt.getTime(), p.zone)}`
      await notify(tx, tenantId, { userId, kind: "report", title: "Shift report missing", body, link: "/reports" }, deps, enqueue)
      for (const r of recipients) await notify(tx, tenantId, { userId: r, kind: "report", title: "Shift report missing", body: `${SUBJECT_TOKEN}: ${body}`, link: "/reports", subjectUserId: userId }, deps, enqueue)
    }
    // the event takes the relay-hint lock: LAST
    for (const p of missing) await publishReportEvent(tx, { tenantId, actorId: DEADLINE_ACTOR, now }, { type: "shift.report.missing", payload: { userId, patternId: p.occ.patternId, shiftDate: p.occ.shiftDate } })
  })
}
