import { and, eq, sql } from "drizzle-orm"
import { canSeeLocation, seesAllLocations } from "@opsdesk/domain/roster-access"
import { Conflict, NotFound } from "../../core/errors"
import { locations, memberships, rosterShifts } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { assertLocation, inScopeSql, type RosterCtx } from "./scope"
import { auditRoster, officeOnly, writeHistory } from "./write"

/** How far back a roster shift still ties a person to a location for a supervisor's read (days). */
export const ROSTERED_LOOKBACK_DAYS = 90

type PersonRow = { userId: string; status: string; homeLocationId: string | null }

/**
 * The member the caller may deal with, or the SAME 404 `member_not_found` for a person who does not exist, belongs to another tenant, or is out of the caller's
 * reach (no oracle). Reach: oneself; an office role that sees every location (anyone); a limited office role or a supervisor: people homed at a location they
 * see, people rostered at one in the last 90 days, and (office only) people homed nowhere. A read-only manager and staff reach only themselves.
 */
export async function reachablePerson(tx: TenantTx, ctx: RosterCtx, userId: string, o: { lock?: "share" | "update" } = {}): Promise<PersonRow> {
  const q = tx
    .select({ userId: memberships.userId, status: memberships.status, homeLocationId: memberships.homeLocationId })
    .from(memberships)
    .where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)))
  const [m] = o.lock ? await q.for(o.lock) : await q
  if (!m) throw NotFound("member_not_found")
  if (m.userId === ctx.me) return m
  const office = ctx.access.scope === "all" && ctx.access.editPublished
  const supervisor = ctx.access.scope === "locations"
  if (!office && !supervisor) throw NotFound("member_not_found")
  if (office) {
    const all = (await tx.select({ id: locations.id }).from(locations).where(eq(locations.tenantId, ctx.tenantId))).map((l) => l.id)
    if (seesAllLocations(ctx.access, all)) return m
    if (!m.homeLocationId) return m // homed nowhere: an office role decides
  }
  if (m.homeLocationId && canSeeLocation(ctx.access, m.homeLocationId)) return m
  const [r] = await tx
    .select({ one: sql<number>`1` })
    .from(rosterShifts)
    .where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.userId, userId), inScopeSql(ctx, rosterShifts.locationId), sql`${rosterShifts.endAt} >= ${ctx.now.toISOString()}::timestamptz - make_interval(days => ${ROSTERED_LOOKBACK_DAYS})`))
    .limit(1)
  if (r) return m
  throw NotFound("member_not_found")
}

/**
 * PUT /v1/members/{userId}/home-location (office only): where the person belongs. Leave approval and a supervisor's read of the person follow it. The location
 * must be one the caller sees (404 like any hidden site) and not archived (409). Writes history on the old and the new site, audit, nothing else.
 */
export async function setHomeLocation(tx: TenantTx, ctx: RosterCtx, userId: string, locationId: string | null): Promise<{ userId: string; homeLocationId: string | null }> {
  officeOnly(ctx)
  const person = await reachablePerson(tx, ctx, userId, { lock: "update" })
  if (locationId !== null) {
    assertLocation(ctx, locationId) // not a uuid, hidden, another tenant's and missing: one 404, before the id reaches SQL
    const [loc] = await tx.select({ id: locations.id, archivedAt: locations.archivedAt }).from(locations).where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, locationId))).for("share")
    if (!loc) throw NotFound()
    if (loc.archivedAt) throw Conflict("location_archived")
  }
  if (person.homeLocationId === locationId) return { userId, homeLocationId: locationId }
  await tx.update(memberships).set({ homeLocationId: locationId }).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)))
  for (const [site, now] of [[person.homeLocationId, { homeLocationId: locationId }], [locationId, { homeLocationId: locationId }]] as const) {
    if (site) await writeHistory(tx, ctx, { locationId: site, action: "home_location_changed", before: { userId, homeLocationId: person.homeLocationId }, after: { userId, ...now } })
  }
  await auditRoster(tx, ctx, { action: "roster.home_location_changed", entity: "membership", entityId: userId, before: { homeLocationId: person.homeLocationId }, after: { homeLocationId: locationId } })
  return { userId, homeLocationId: locationId }
}
