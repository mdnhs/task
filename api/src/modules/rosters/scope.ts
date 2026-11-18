import { and, eq, sql, type AnyColumn, type SQL } from "drizzle-orm"
import type { Context, MiddlewareHandler } from "hono"
import { can } from "@opsdesk/domain/permissions"
import { rosterAccess, canSeeLocation, type RosterAccess } from "@opsdesk/domain/roster-access"
import type { AppEnv, ResolvedRole } from "../../core/context"
import { AppError, Forbidden, NotFound } from "../../core/errors"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { actorIdOf, subjectUserId } from "../../core/middleware/principal"
import { requireTenant } from "../../core/middleware/tenant"
import { locationSupervisors, locations, roles, rosterOfficeLimits } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { lockActor } from "../rbac"

/**
 * Two-key advisory lock namespace of every roster write ("rost", R8-5). ONE writer per tenant, taken FIRST (before lockActor and any row lock),
 * released at commit or rollback. Cross-location rules (a person double-booked at two sites) need a consistent read of the person's other shifts,
 * which a per-location lock could not give. Order inside a roster mutation: lockRoster, lockActor, rows FOR UPDATE, writes, history, notify, audit, publish.
 */
export const ROSTER_LOCK_NS = 0x726f7374

/** How long a roster writer waits for the tenant lock before giving up (55P03 -> 409 retry), so a slow or stuck writer cannot hang every roster write. */
export const ROSTER_LOCK_TIMEOUT_MS = 5000

/** The transactions that took the roster lock (and for which tenant): the order rule is checked in memory, no pg_locks scan. */
const lockedTx = new WeakMap<TenantTx, string>()

/**
 * Takes the tenant's roster lock. `set local lock_timeout` applies to the rest of this transaction (later row and actor locks too): any lock wait
 * longer than 5 s fails with 55P03, which app.ts answers as 409 `retry` like a deadlock.
 */
export async function lockRoster(tx: TenantTx, tenantId: string): Promise<void> {
  await tx.execute(sql.raw(`set local lock_timeout = ${ROSTER_LOCK_TIMEOUT_MS}`))
  await tx.execute(sql`select pg_advisory_xact_lock(${ROSTER_LOCK_NS}::int, hashtext(${tenantId}::text))`)
  lockedTx.set(tx, tenantId)
}

/**
 * Everything a roster operation needs to know about the caller. `me` is whose data the caller sees (the creator for an API key), `actorId` is who DID it.
 * `access` is the domain `rosterAccess` result for this person (scope, visible locations, edit flags): the single source of every cut below.
 */
export type RosterCtx = { tenantId: string; tz: string; me: string; actorId: string; role: ResolvedRole; access: RosterAccess; now: Date }

/**
 * The caller's roster context. A mutation passes `need: "write"`: it MUST already hold the roster lock (a programming error otherwise, thrown as a plain
 * Error so it surfaces as a 500 in tests, never silently), then the actor's membership and role are re-read in the tx with FOR SHARE (R25).
 * The role's `roster_level`, the caller's supervisor grants and office limits and the tenant's locations are read here, in the same tx.
 * Archived locations stay in the visible set (their weeks and history remain readable); the service decides whether an archived site is editable.
 */
export async function loadRosterCtx(c: Context<AppEnv>, tx: TenantTx, need: "read" | "write" | "self" = "read"): Promise<RosterCtx> {
  const tenant = c.get("tenant")!
  const actorId = actorIdOf(c)
  if (need !== "read" && lockedTx.get(tx) !== tenant.id) throw new Error(`loadRosterCtx(${need}) requires lockRoster first (R8-5 lock order)`)
  // "self": a write to the caller's OWN data (leave, availability): the same lock order and actor re-read, but roster READ is enough
  const role = need === "read" ? c.get("role")! : await lockActor(tx, tenant.id, actorId, "roster", need === "write" ? "write" : "read")
  if (!can(role, "roster", need === "write" ? "write" : "read")) throw Forbidden("forbidden") // the route guard already answered; fail closed
  const me = subjectUserId(c)
  const [row] = await tx.select({ level: roles.rosterLevel }).from(roles).where(and(eq(roles.tenantId, tenant.id), eq(roles.id, role.id)))
  const level = row?.level === "office" || row?.level === "supervisor" ? row.level : undefined
  const all = (await tx.select({ id: locations.id }).from(locations).where(eq(locations.tenantId, tenant.id)).orderBy(locations.id)).map((l) => l.id)
  const grants = (await tx.select({ locationId: locationSupervisors.locationId }).from(locationSupervisors).where(and(eq(locationSupervisors.tenantId, tenant.id), eq(locationSupervisors.userId, me)))).map((g) => ({ locationId: g.locationId, personId: me }))
  const except = (await tx.select({ locationId: rosterOfficeLimits.locationId }).from(rosterOfficeLimits).where(and(eq(rosterOfficeLimits.tenantId, tenant.id), eq(rosterOfficeLimits.userId, me)))).map((l) => l.locationId)
  const access = rosterAccess({ ...role, rosterLevel: level }, me, grants, [{ personId: me, except }], all)
  if (access.scope === "none") throw Forbidden("forbidden")
  return { tenantId: tenant.id, tz: tenant.timezone, me, actorId, role, access, now: c.get("deps").clock.now() }
}

/** R8-4: a location the caller may not see is a 404, identical to one that does not exist (no existence oracle, no counts, never 403). */
export function assertLocation(ctx: RosterCtx, locationId: string): void {
  if (!canSeeLocation(ctx.access, locationId)) throw NotFound()
}

/**
 * The SQL cut of the caller's visible locations on `column`: `column IN (the visible ids)`. Built from the SAME list the adapter returned, so a filter
 * and assertLocation can never disagree. No visible location (and the "own" scope, which has no location view) is `false`, never "everything": a site created
 * after the context was read is hidden, not leaked. Scope "all" with an except list is still a list (an office role may be cut by FR-RS-04).
 */
export function inScopeSql(ctx: RosterCtx, column: AnyColumn): SQL {
  const ids = ctx.access.locationIds
  if (!ids || ids.length === 0) return sql`false`
  return sql`${column} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`
}

/**
 * R8-8 publish lock. A role that may not edit at all is 403 forbidden. A draft week is open to everyone who can edit drafts. A PUBLISHED week is locked
 * for a supervisor (403 roster_locked) and open to an office role only with a non-blank reason (422 reason_required).
 */
export function weekEditGate(ctx: RosterCtx, week: { status: "draft" | "published" }, reason?: string): void {
  if (!ctx.access.editDraft) throw Forbidden("forbidden")
  if (week.status === "draft") return
  if (!ctx.access.editPublished) throw Forbidden("roster_locked")
  if (!reason || reason.trim() === "") throw new AppError(422, "reason_required", "Unprocessable Entity")
}

/** Route guard of every roster route: tenant, the M1A product module (402/403 rules), the `roster` permission. */
export const rosterGuard = (need: "read" | "write"): MiddlewareHandler<AppEnv>[] => [requireTenant, requireModule("M1A"), requirePermission("roster", need)]
