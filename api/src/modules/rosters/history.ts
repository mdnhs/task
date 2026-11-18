import { and, desc, eq, lt, or } from "drizzle-orm"
import { canSeeLocation } from "@opsdesk/domain/roster-access"
import { decodeCursor, encodeCursor } from "../../core/cursor"
import { AppError, NotFound } from "../../core/errors"
import { rosterHistory } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { HistoryDto } from "./dto"
import { assertLocation, type RosterCtx } from "./scope"
import { loadWeek } from "./weeks"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

/** Keys that hold a location id inside a before/after snapshot (a person's home site, a site list). A value the caller cannot see is masked, never passed through. */
const LOCATION_KEYS = new Set(["homeLocationId", "locationId", "fromLocationId", "toLocationId"])
const LOCATION_LISTS = new Set(["locationIds", "except"])

/**
 * A history snapshot as the caller may read it. `people.ts` keeps the OLD site's uuid in `home_location_changed` (it is written on both the old and the new site's history), so a
 * supervisor of only one of them must not learn the other's id: every location id the caller cannot see becomes null (a list drops it). The walk is generic, so a future snapshot
 * that carries a site id under one of these keys is covered too. Ids of people stay (history holds ids only, never names, R8-13).
 */
export function maskSites(value: unknown, ctx: RosterCtx): unknown {
  if (Array.isArray(value)) return value.map((v) => maskSites(v, ctx))
  if (value === null || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (LOCATION_KEYS.has(k) && typeof v === "string") out[k] = canSeeLocation(ctx.access, v) ? v : null
    else if (LOCATION_LISTS.has(k) && Array.isArray(v)) out[k] = v.filter((x) => typeof x !== "string" || canSeeLocation(ctx.access, x))
    else out[k] = maskSites(v, ctx)
  }
  return out
}

type Page = { limit?: string; cursor?: string }

async function page(tx: TenantTx, ctx: RosterCtx, scope: { locationId: string; weekId?: string }, q: Page): Promise<{ items: HistoryDto[]; nextCursor: string | null }> {
  const limit = q.limit === undefined ? DEFAULT_LIMIT : /^\d{1,3}$/.test(q.limit) ? Number(q.limit) : 0
  if (limit < 1 || limit > MAX_LIMIT) throw new AppError(422, "invalid_filter", "Unprocessable Entity")
  const after = q.cursor === undefined ? undefined : decodeCursor(q.cursor)
  const rows = await tx
    .select()
    .from(rosterHistory)
    .where(
      and(
        eq(rosterHistory.tenantId, ctx.tenantId), eq(rosterHistory.locationId, scope.locationId), scope.weekId ? eq(rosterHistory.weekId, scope.weekId) : undefined,
        after ? or(lt(rosterHistory.createdAt, after.at), and(eq(rosterHistory.createdAt, after.at), lt(rosterHistory.id, after.id))) : undefined,
      ),
    )
    .orderBy(desc(rosterHistory.createdAt), desc(rosterHistory.id))
    .limit(limit + 1)
  const items = rows.slice(0, limit)
  const last = items[items.length - 1]
  return {
    items: items.map((r) => ({
      id: r.id, at: r.createdAt.toISOString(), actorId: r.actorId, action: r.action, locationId: r.locationId, weekId: r.weekId, shiftId: r.shiftId, reason: r.reason,
      before: maskSites(r.before, ctx) as Record<string, unknown> | null, after: maskSites(r.after, ctx) as Record<string, unknown> | null,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  }
}

/** GET /v1/roster/weeks/{id}/history: the week's lines, newest first (created, then id), keyset cursor. A week the caller may not see is the plain 404. */
export async function weekHistory(tx: TenantTx, ctx: RosterCtx, weekId: string, q: Page) {
  const { week } = await loadWeek(tx, ctx, weekId, false)
  return page(tx, ctx, { locationId: week.locationId, weekId: week.id }, q)
}

/** GET /v1/locations/{id}/history: every roster line of the site (weeks, shifts, supervisors, shift types, home changes). A site the caller may not see is the plain 404 before the id reaches SQL. */
export async function locationHistory(tx: TenantTx, ctx: RosterCtx, locationId: string, q: Page) {
  assertLocation(ctx, locationId)
  if (!/^[0-9a-f-]{36}$/i.test(locationId)) throw NotFound() // canSeeLocation only matches real ids; fail closed
  return page(tx, ctx, { locationId }, q)
}
