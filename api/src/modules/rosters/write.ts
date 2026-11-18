import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { Forbidden } from "../../core/errors"
import { publish } from "../../core/events"
import type { EventType } from "../../core/events/types"
import { rosterHistory } from "../../db/schema"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import type { Deps } from "../../deps"
import { recordAudit } from "../audit"
import { withTenantAfterCommit, type Enqueue } from "../notifications"
import { loadRosterCtx, lockRoster, type RosterCtx } from "./scope"
import { seesAllLocations } from "@opsdesk/domain/roster-access"

/** What a roster mutation can use besides the tx: the deps and the after-commit job buffer notifications need (`notify` never sends inside the tx). */
export type RosterEnv = { deps: Deps; enqueue: Enqueue }

/** A read: one tenant tx and the caller's roster context (scope, visible locations). */
export const rosterRead = <T>(c: Context<AppEnv>, fn: (tx: TenantTx, ctx: RosterCtx) => Promise<T>): Promise<T> =>
  withTenant(c.get("deps").db, c.get("tenant")!.id, async (tx) => fn(tx, await loadRosterCtx(c, tx)))

/**
 * A mutation, in the one order every roster write uses (R8-5): the tenant roster lock FIRST, then the actor re-read (R25, inside `loadRosterCtx`), then the
 * service takes its rows FOR UPDATE, writes, roster history, notify, audit and publishes LAST. Notifications buffer their jobs until the tx commits.
 */
export const rosterWrite = <T>(c: Context<AppEnv>, fn: (tx: TenantTx, ctx: RosterCtx, env: RosterEnv) => Promise<T>): Promise<T> => {
  const deps = c.get("deps")
  const tenantId = c.get("tenant")!.id
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    await lockRoster(tx, tenantId)
    return fn(tx, await loadRosterCtx(c, tx, "write"), { deps, enqueue })
  })
}

/** Office-level roster roles only (edit published weeks): a supervisor, a read-only manager and staff are 403 whatever the id. */
export function officeOnly(ctx: RosterCtx): void {
  if (ctx.access.scope !== "all" || !ctx.access.editPublished) throw Forbidden("forbidden")
}

/** An office role with NO "all except" cut: only it may change who else is cut (a limited office person cannot lift their own limit). `all` = every location id of the tenant. */
export function unrestrictedOffice(ctx: RosterCtx, all: string[]): void {
  officeOnly(ctx)
  if (!seesAllLocations(ctx.access, all)) throw Forbidden("forbidden")
}

/** One roster history line (FR-RS-24): ids only, never a name, so an erasure cannot leave a person's name in the log (R8-13). */
export async function writeHistory(
  tx: TenantTx, ctx: Pick<RosterCtx, "tenantId" | "actorId" | "now">,
  h: { locationId: string; weekId?: string | null; shiftId?: string | null; action: string; reason?: string | null; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null },
): Promise<void> {
  await tx.insert(rosterHistory).values({
    tenantId: ctx.tenantId, locationId: h.locationId, weekId: h.weekId ?? null, shiftId: h.shiftId ?? null, action: h.action, actorId: ctx.actorId,
    reason: h.reason ?? null, before: h.before ?? null, after: h.after ?? null, createdAt: ctx.now,
  })
}

/** The hash-chained audit line of a roster mutation (security view; R8-13). */
export const auditRoster = async (tx: TenantTx, ctx: Pick<RosterCtx, "tenantId" | "actorId" | "now">, a: { action: string; entity: string; entityId: string; before: unknown; after: unknown }): Promise<void> => {
  await recordAudit(tx, ctx.tenantId, { action: a.action, entity: a.entity, entityId: a.entityId, actorId: ctx.actorId, before: a.before, after: a.after }, ctx.now)
}

/** Domain event of a roster mutation: ids only (F19); call LAST (publish takes the relay-hint lock). */
export const publishRoster = async (tx: TenantTx, ctx: Pick<RosterCtx, "tenantId" | "actorId" | "now">, type: EventType, payload: Record<string, unknown>): Promise<void> => {
  await publish(tx, { tenantId: ctx.tenantId, type, payload, actorId: ctx.actorId }, ctx.now)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** True for a uuid. A roster id that is not one answers the SAME 404 as a missing one and never reaches SQL (a uuid column would raise 22P02 and tell a prober the shape). */
export const isUuid = (v: string): boolean => UUID.test(v)
