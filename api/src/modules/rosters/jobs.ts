import { and, asc, eq, sql } from "drizzle-orm"
import { addDays, epochToWall } from "@opsdesk/domain/shifts"
import { rosterAccess } from "@opsdesk/domain/roster-access"
import type { ResolvedRole } from "../../core/context"
import { registerJob } from "../../core/queue/queue"
import { startSweep } from "../../core/observability/sweep"
import { locations, rosterAutoRepeatRuns, rosterWeeks, tenants } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { errorInfo } from "../../core/safe-error"
import { tenantEntitlements } from "../entitlements/service"
import { withTenantAfterCommit } from "../notifications"
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
 * that began is not drafted late). One per location (the latest), near-due ones only, at most `limit`. The SQL window is a day wider than the exact test so the zone cannot hide one.
 */
async function candidates(tx: TenantTx, tenantId: string, tenantTz: string, now: Date, limit: number): Promise<Candidate[]> {
  const utcDay = epochToWall(now.getTime(), "UTC").slice(0, 10)
  const rows = await tx
    .select({ id: rosterWeeks.id, locationId: rosterWeeks.locationId, weekStart: rosterWeeks.weekStart, days: rosterWeeks.autoRepeatDays, zone: locations.timeZone })
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
    .orderBy(asc(rosterWeeks.locationId), sql`${rosterWeeks.weekStart} desc`)
  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const r of rows) {
    if (seen.has(r.locationId)) continue // the latest published week of the location is the source
    seen.add(r.locationId)
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
    const everyone = await approversOf(tx, tenantId, src.locationId, { supervisors: true, exclude: [] })
    const office = new Set(await approversOf(tx, tenantId, src.locationId, { supervisors: false, exclude: [] }))
    const supervisors = everyone.filter((u) => !office.has(u))
    const told = supervisors.length > 0 ? supervisors : [...office] // nobody supervises the site: the office roles that cover it hear instead
    await notifyActive(tx, ctx, env, told.map((userId) => ({ userId, title: DRAFT_READY.title, body: DRAFT_READY.body(target) })))
    return true
  })
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

/** Registers the roster jobs (worker.ts, tests). Safe to call again. */
export function registerRosters(): void {
  registerJob(AUTO_REPEAT_JOB, runAutoRepeatJob)
}
