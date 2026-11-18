import { and, asc, between, eq, notExists, sql } from "drizzle-orm"
import { addDays, epochToWall } from "@opsdesk/domain/shifts"
import { rosterAccess } from "@opsdesk/domain/roster-access"
import type { ResolvedRole } from "../../core/context"
import { registerJob } from "../../core/queue/queue"
import { startSweep } from "../../core/observability/sweep"
import { locations, memberQualifications, memberships, qualificationExpiryNotices, rosterAutoRepeatRuns, rosterWeeks, tenants } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { errorInfo } from "../../core/safe-error"
import { tenantEntitlements } from "../entitlements/service"
import { notifyMany, SUBJECT_TOKEN, withTenantAfterCommit, type NotifyInput } from "../notifications"
import { approversOf, notifyActive } from "./events"
import { copyWeek } from "./repeat"
import { lockRoster, type RosterCtx } from "./scope"
import type { WeekRow } from "./weeks"
import type { RosterEnv } from "./write"

// The roster sweeps (B8 Tasks 13 and 14). Every job: active tenants that still have M1A and are not blocked for payment, `deps.clock` only, ONE transaction per unit of work under the tenant roster
// lock (taken first, like every roster write), a unit failing never stops the others (its tenant id and a safe code are logged, never a name or a message), and the ledger insert is the arbiter
// so a second worker, a retry or a restart does nothing twice.

/** The system actor of what a job writes (history, audit, `created_by`). */
export const AUTO_REPEAT_ACTOR = "system:roster-auto-repeat"
export const AUTO_REPEAT_JOB = "roster.auto-repeat"
/** Weeks one run copies per tenant; the rest are done by the next run (the schedule is 15 minutes). */
export const AUTO_REPEAT_BATCH = 50
/** A site whose copy failed is left alone for 15 min x 2^failures (30 min, 1 h, 2 h ... at most 12 h) from its last attempt; a success clears the count. */
export const AUTO_REPEAT_BACKOFF_MS = 15 * 60_000
export const AUTO_REPEAT_BACKOFF_MAX_MS = 12 * 3_600_000
export const autoRepeatBackoffMs = (failures: number): number => Math.min(AUTO_REPEAT_BACKOFF_MAX_MS, AUTO_REPEAT_BACKOFF_MS * 2 ** Math.min(failures, 10))

/** The context a job runs a roster operation in: it sees and edits every location (the roster lock is held by the caller). */
export async function systemCtx(tx: TenantTx, tenantId: string, tz: string, now: Date, actorId: string): Promise<RosterCtx> {
  const all = (await tx.select({ id: locations.id }).from(locations).where(eq(locations.tenantId, tenantId)).orderBy(locations.id)).map((l) => l.id)
  const role = { key: "system", home: "admin", access: { roster: "write" }, fieldRules: {}, rosterLevel: "office" } as unknown as ResolvedRole
  const access = rosterAccess(role, actorId, [], [], all)
  return { tenantId, tz, me: actorId, actorId, role, access, now, allLocationIds: all }
}

/** The tenants a roster job serves: active, with M1A, not blocked for payment (the deadline job's rule). `tenants` has no RLS. */
export async function rosterTenants(deps: Deps): Promise<{ id: string; tz: string }[]> {
  const rows = await deps.db.select({ id: tenants.id, tz: tenants.timezone }).from(tenants).where(eq(tenants.status, "active")).orderBy(asc(tenants.id))
  const out: { id: string; tz: string }[] = []
  for (const t of rows) {
    const ent = await tenantEntitlements(deps.db, t.id, deps.clock.now())
    if (ent.allowed.includes("M1A") && ent.billingState !== "blocked") out.push(t)
  }
  return out
}

/** A code that is safe to log (never a message: it may hold a name or a SQL fragment). */
export const safeCode = (e: unknown): string => {
  const c = errorInfo(e).code
  return typeof c === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(c) ? c : "error"
}

export type Candidate = { id: string; locationId: string; weekStart: string; days: number; zone: string }

/**
 * The published weeks with auto-repeat on whose successor does not exist yet and whose next Monday is within `days` of TODAY in the location's own zone (never before it starts: a week
 * that began is not drafted late). One per location (the latest), near-due ones only, at most `limit`, longest-waiting site first; a site that failed recently is skipped until its back-off is over. The SQL window is a day wider than the exact test so the zone cannot hide one.
 */
async function candidates(tx: TenantTx, tenantId: string, tenantTz: string, now: Date, limit: number): Promise<Candidate[]> {
  const utcDay = epochToWall(now.getTime(), "UTC").slice(0, 10)
  const rows = await tx
    .select({ id: rosterWeeks.id, locationId: rosterWeeks.locationId, weekStart: rosterWeeks.weekStart, days: rosterWeeks.autoRepeatDays, zone: locations.timeZone, attemptAt: locations.autoRepeatAttemptAt, failures: locations.autoRepeatFailures })
    .from(rosterWeeks)
    .innerJoin(locations, and(eq(locations.tenantId, rosterWeeks.tenantId), eq(locations.id, rosterWeeks.locationId)))
    .where(
      and(
        eq(rosterWeeks.tenantId, tenantId), eq(rosterWeeks.status, "published"), sql`${rosterWeeks.autoRepeatDays} is not null`, sql`${locations.archivedAt} is null`,
        sql`not exists (select 1 from roster_weeks n where n.tenant_id = ${rosterWeeks.tenantId} and n.location_id = ${rosterWeeks.locationId} and n.week_start = ${rosterWeeks.weekStart} + 7)`,
        sql`(${rosterWeeks.weekStart} + 7) - ${rosterWeeks.autoRepeatDays}::int <= ${addDays(utcDay, 1)}::date`,
        sql`(${rosterWeeks.weekStart} + 7) >= ${addDays(utcDay, -1)}::date`,
      ),
    )
    .orderBy(sql`${locations.autoRepeatAttemptAt} asc nulls first`, asc(rosterWeeks.locationId), sql`${rosterWeeks.weekStart} desc`) // the longest-waiting site first: a run that stops at `limit` cannot starve the same sites behind it
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const r of rows) {
    if (seen.has(r.locationId)) continue // the latest published week of the location is the source
    seen.add(r.locationId)
    if (r.failures > 0 && r.attemptAt && now.getTime() < r.attemptAt.getTime() + autoRepeatBackoffMs(r.failures)) continue // backing off after failures
    const zone = r.zone ?? tenantTz
    const today = epochToWall(now.getTime(), zone).slice(0, 10)
    const next = addDays(r.weekStart, 7)
    const ahead = Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    if (ahead >= 0 && ahead <= r.days!) out.push({ id: r.id, locationId: r.locationId, weekStart: r.weekStart, days: r.days!, zone })
    if (out.length >= limit) break
  }
  return out
}

const DRAFT_READY = { title: "Roster draft ready", body: (weekStart: string) => `A draft roster for the week starting ${weekStart} was created from the previous week. Review and publish it.` }

/** Copies one due week into its successor (one transaction, under the roster lock). The plan was read earlier, so everything is re-read under the lock: a source that is no longer published or whose successor now exists changes nothing. Returns whether a draft was created. */
export async function repeatOne(deps: Deps, tenantId: string, tz: string, c: Candidate, now: Date): Promise<boolean> {
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockRoster(tx, tenantId)
    const ctx = await systemCtx(tx, tenantId, tz, now, AUTO_REPEAT_ACTOR)
    const env: RosterEnv = { deps, enqueue }
    // state may have moved since the plan: re-read the source under the lock
    const [src] = await tx.select().from(rosterWeeks).where(and(eq(rosterWeeks.tenantId, tenantId), eq(rosterWeeks.id, c.id))).for("update")
    if (!src || src.status !== "published" || src.autoRepeatDays === null) return false
    const target = addDays(src.weekStart, 7)
    const [exists] = await tx.select({ id: rosterWeeks.id }).from(rosterWeeks).where(and(eq(rosterWeeks.tenantId, tenantId), eq(rosterWeeks.locationId, src.locationId), eq(rosterWeeks.weekStart, target)))
    if (exists) return false // somebody made it by hand: nothing to copy over, nothing to tell
    const [row] = await tx.insert(rosterAutoRepeatRuns).values({ tenantId, sourceWeekId: src.id, targetWeekStart: target, createdAt: now }).onConflictDoNothing().returning({ w: rosterAutoRepeatRuns.sourceWeekId })
    if (!row) return false // another worker (or an earlier run) already did this one
    await copyWeek(tx, ctx, { week: src as WeekRow, zone: c.zone }, [{ weekStart: target, existing: null }], "auto_repeat")
    await tx.update(locations).set({ autoRepeatAttemptAt: now, autoRepeatFailures: 0 }).where(and(eq(locations.tenantId, tenantId), eq(locations.id, src.locationId)))
    const everyone = await approversOf(tx, tenantId, src.locationId, { supervisors: true, exclude: [] })
    const office = new Set(await approversOf(tx, tenantId, src.locationId, { supervisors: false, exclude: [] }))
    const supervisors = everyone.filter((u) => !office.has(u))
    const told = supervisors.length > 0 ? supervisors : [...office] // nobody supervises the site: the office roles that cover it hear instead
    await notifyActive(tx, ctx, env, told.map((userId) => ({ userId, title: DRAFT_READY.title, body: DRAFT_READY.body(target) })))
    return true
  })
}

/** Counts one failed copy at a site (its own transaction, after the copy rolled back). Never throws: the back-off is an aid, the run goes on without it. */
async function recordFailure(deps: Deps, tenantId: string, locationId: string, now: Date): Promise<void> {
  try {
    await withTenant(deps.db, tenantId, (tx) =>
      tx.update(locations).set({ autoRepeatAttemptAt: now, autoRepeatFailures: sql`${locations.autoRepeatFailures} + 1` }).where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId))),
    )
  } catch (err) {
    deps.logger.error({ tenantId, errCode: safeCode(err) }, "roster auto-repeat could not record a failure")
  }
}

/**
 * Job `roster.auto-repeat` (every 15 minutes, `{ batch? }`; FR-RS-28, R8-12): creates the next DRAFT of every published week that has auto-repeat on, `days` before it starts, copying people and
 * times with the repeat engine (leave, clashes, leavers and qualifications become open shifts with a conflict), and tells the location's supervisors once. Exactly once per (source week, target
 * week): the ledger `roster_auto_repeat_runs` is inserted ON CONFLICT DO NOTHING in the same transaction as the copy, so a rollback removes both and a second worker finds the week there.
 */
export async function runAutoRepeatJob(data: unknown, deps: Deps): Promise<void> {
  const batch = Math.max(1, Math.min(AUTO_REPEAT_BATCH, Number((data as { batch?: unknown } | null)?.batch) || AUTO_REPEAT_BATCH))
  const sweep = startSweep(deps, AUTO_REPEAT_JOB)
  try {
    for (const t of await rosterTenants(deps)) {
      sweep.tenant()
      try {
        const now = deps.clock.now()
        const due = await withTenant(deps.db, t.id, (tx) => candidates(tx, t.id, t.tz, now, batch))
        let created = 0
        for (const c of due) {
          try {
            if (await repeatOne(deps, t.id, t.tz, c, now)) created++
          } catch (err) {
            // a conflict, a lock timeout or a bad row wrote nothing (the ledger row rolled back with it): the next run tries again; ids and a safe code only
            deps.logger.error({ tenantId: t.id, errCode: safeCode(err) }, "roster auto-repeat failed for a week")
            await recordFailure(deps, t.id, c.locationId, now) // outside the rolled-back copy: the back-off survives it
          }
        }
        if (created > 0) await deps.readModelCache.bust(t.id) // the new drafts show in the attention feed within one read
      } catch (err) {
        deps.logger.error({ tenantId: t.id, errCode: safeCode(err) }, "roster auto-repeat failed for a tenant")
      }
    }
  } finally {
    sweep.done()
  }
}

// ------------------------------------------------------------------ qualification expiry (FR-RS-40)

export const QUALIFICATION_EXPIRY_JOB = "roster.qualification-expiry"
export const EXPIRY_ACTOR = "system:roster-qualification-expiry"
/** Qualifications one run enters in the ledger and tells about per tenant; the rest are done by the next run (the schedule is hourly). */
export const EXPIRY_BATCH = 200
/** The days before the expiry date at which the person and the office are told (the SMALLEST lead that covers the days left is the current one). */
export const EXPIRY_LEADS = [1, 7, 14, 30] as const
/** A licence that expired up to this many days ago is still reported once (an outage must not lose it); an older one is not, so the first run on a new tenant is not a flood. */
export const EXPIRY_CATCH_UP_DAYS = 7
/** The "no site" id of an office audience: no except-list row can match it, so every office role is asked. */
const NO_SITE = "00000000-0000-0000-0000-000000000000"

/** The lead bucket of `daysLeft` days to the expiry date: 0 once it has expired (reported once), else the smallest lead that covers it; null when outside the window. */
export function expiryLead(daysLeft: number): number | null {
  if (daysLeft < -EXPIRY_CATCH_UP_DAYS) return null
  if (daysLeft < 0) return 0
  return EXPIRY_LEADS.find((l) => daysLeft <= l) ?? null
}

type Due = { userId: string; type: string; expiresOn: string; lead: number; home: string | null }

/** The qualifications that need a notice today: active members, inside the window, and no ledger row for their CURRENT lead. Soonest first, at most `limit`. */
async function dueQualifications(tx: TenantTx, tenantId: string, today: string, limit: number): Promise<Due[]> {
  const mq = memberQualifications
  const n = qualificationExpiryNotices
  const left = sql`(${mq.expiresOn} - ${today}::date)`
  const lead = sql<number>`(case when ${left} < 0 then 0 ${sql.join(EXPIRY_LEADS.map((l) => sql`when ${left} <= ${l} then ${l}`), sql` `)} else null end)`
  const max = EXPIRY_LEADS[EXPIRY_LEADS.length - 1]
  const rows = await tx
    .select({ userId: mq.userId, type: mq.type, expiresOn: mq.expiresOn, lead, home: memberships.homeLocationId })
    .from(mq)
    .innerJoin(memberships, and(eq(memberships.tenantId, mq.tenantId), eq(memberships.userId, mq.userId)))
    .where(
      and(
        eq(mq.tenantId, tenantId), eq(memberships.status, "active"), between(mq.expiresOn, addDays(today, -EXPIRY_CATCH_UP_DAYS), addDays(today, max)),
        notExists(tx.select({ one: sql`1` }).from(n).where(and(eq(n.tenantId, mq.tenantId), eq(n.userId, mq.userId), eq(n.type, mq.type), eq(n.expiresOn, mq.expiresOn), sql`${n.leadDays} = ${lead}`))),
      ),
    )
    .orderBy(asc(mq.expiresOn), asc(mq.userId), asc(mq.type))
    .limit(limit)
  const daysLeft = (date: string): number => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  // the SQL above only narrows the candidates; `expiryLead` is the rule: a row the two disagree on is never told
  return rows.map((r) => ({ userId: r.userId, type: r.type, expiresOn: r.expiresOn!, lead: Number(r.lead), home: r.home })).filter((d) => expiryLead(daysLeft(d.expiresOn)) === d.lead)
}

/**
 * One tenant's notices, ONE transaction under the roster lock: the ledger rows are inserted ON CONFLICT DO NOTHING RETURNING and only the rows that came back are told (a second worker, a retry
 * or a restart inserts nothing and so sends nothing; a failure rolls the ledger back with the notices). The person hears "Your <licence> expires on <date>"; the office roles that cover the
 * person's home site (all of them for a person homed nowhere; a Roster Manager excepted from the site is not asked) hear `{{subject}}: <licence> expires on <date>`: the name is rendered when it is
 * read, never stored. Active people only, in one `notifyMany` batch. Returns how many licences were told.
 */
async function noticesOne(deps: Deps, tenantId: string, tz: string, now: Date, limit: number): Promise<number> {
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockRoster(tx, tenantId)
    const today = epochToWall(now.getTime(), tz).slice(0, 10)
    const due = await dueQualifications(tx, tenantId, today, limit)
    if (due.length === 0) return 0
    const fresh = await tx
      .insert(qualificationExpiryNotices)
      .values(due.map((d) => ({ tenantId, userId: d.userId, type: d.type, expiresOn: d.expiresOn, leadDays: d.lead, createdAt: now })))
      .onConflictDoNothing()
      .returning({ userId: qualificationExpiryNotices.userId, type: qualificationExpiryNotices.type, expiresOn: qualificationExpiryNotices.expiresOn, lead: qualificationExpiryNotices.leadDays })
    const told = new Set(fresh.map((f) => `${f.userId}|${f.type}|${f.expiresOn}|${f.lead}`))
    const send = due.filter((d) => told.has(`${d.userId}|${d.type}|${d.expiresOn}|${d.lead}`))
    const audience = new Map<string, string[]>()
    const inputs: NotifyInput[] = []
    for (const d of send) {
      const expired = d.lead === 0
      const title = expired ? "Qualification expired" : "Qualification expiring"
      const what = `${d.type} ${expired ? "expired" : "expires"} on ${d.expiresOn}`
      inputs.push({ userId: d.userId, kind: "member", title, body: `Your ${what}. Please renew it.`, link: "/rosters" })
      const key = d.home ?? NO_SITE
      if (!audience.has(key)) audience.set(key, await approversOf(tx, tenantId, key, { supervisors: false, exclude: [] }))
      for (const userId of audience.get(key)!) if (userId !== d.userId) inputs.push({ userId, kind: "member", title, body: `${SUBJECT_TOKEN}: ${what}`, link: "/rosters", subjectUserId: d.userId })
    }
    await notifyMany(tx, tenantId, inputs, deps, enqueue)
    return send.length
  })
}

/**
 * Job `roster.qualification-expiry` (every hour, `{ batch? }`; FR-RS-40): the person and the office are told at 30, 14, 7 and 1 days before a qualification's expiry date and once when it has
 * expired (see `expiryLead`: only the CURRENT lead is sent, never a backlog). Exactly once per (person, qualification, expiry date, lead) through the ledger `qualification_expiry_notices`, so renewing
 * (a new expiry date) starts a new cycle. Tenants with M1A only; the day is the tenant's (deps.clock); ids and a safe code are logged, never a name.
 */
export async function runQualificationExpiryJob(data: unknown, deps: Deps): Promise<void> {
  const batch = Math.max(1, Math.min(EXPIRY_BATCH, Number((data as { batch?: unknown } | null)?.batch) || EXPIRY_BATCH))
  const sweep = startSweep(deps, QUALIFICATION_EXPIRY_JOB)
  try {
    for (const t of await rosterTenants(deps)) {
      sweep.tenant()
      try {
        await noticesOne(deps, t.id, t.tz, deps.clock.now(), batch)
      } catch (err) {
        deps.logger.error({ tenantId: t.id, errCode: safeCode(err) }, "roster qualification expiry failed for a tenant")
      }
    }
  } finally {
    sweep.done()
  }
}

/** Registers the roster jobs (worker.ts, tests). Safe to call again. */
export function registerRosters(): void {
  registerJob(AUTO_REPEAT_JOB, runAutoRepeatJob)
  registerJob(QUALIFICATION_EXPIRY_JOB, runQualificationExpiryJob)
}
