import { and, asc, desc, eq, gte, inArray, lt, lte, notExists, or, sql, type SQL } from "drizzle-orm"
import { canSeeLocation } from "@opsdesk/domain/roster-access"
import { epochToWall } from "@opsdesk/domain/shifts"
import { decodeCursor, encodeCursor } from "../../core/cursor"
import { AppError, Conflict, Forbidden, NotFound } from "../../core/errors"
import { leaveRequests, locations, locationSupervisors, memberships, roles, rosterAvailability, rosterOfficeLimits } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { notify } from "../notifications"
import type { AvailabilityDto, LeaveDto } from "./dto"
import { realDate } from "./qualifications"
import { inScopeSql, type RosterCtx } from "./scope"
import { auditRoster, isUuid, publishRoster, type RosterEnv } from "./write"

// Leave requests and availability (FR-RS-41, R8-7). A request is the person's own; it is decided (D8) by a supervisor of the person's HOME location, or by an
// office role whose scope covers that home (a person homed nowhere: any office role; a Roster Manager with an `except` never decides for the excepted site),
// and never by the requester. A leave that is not visible to the caller is the same 404 `leave_not_found` as one that does not exist.
// D8 deciders = the home supervisor OR an office role in scope (either may decide). The NOTIFICATION audience (a request, and the cancelling of an approved leave) is BOTH
// groups when both exist; nobody is ever told about their own request.

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const notFound = () => NotFound("leave_not_found")
const NOTE_MAX = 500
const KIND_MAX = 40
const MAX_SPAN_DAYS = 366
const MAX_WINDOWS = 50
const STATUSES = ["requested", "approved", "rejected", "cancelled"] as const
const CONTROL = /[\u0000-\u001f\u007f]/
const DAY_MS = 86_400_000

type Row = typeof leaveRequests.$inferSelect
const view = (r: Row): LeaveDto => ({
  id: r.id, userId: r.userId, from: r.fromDate, to: r.toDate, kind: r.kind, status: r.status as LeaveDto["status"], note: r.note, decidedBy: r.decidedBy,
  decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote, createdAt: r.createdAt.toISOString(),
})

const dayCount = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
const cleanText = (v: string | undefined, max: number): string | null => {
  const t = (v ?? "").trim()
  return t.length > max || CONTROL.test(t.replace(/[\r\n\t]/g, " ")) ? null : t
}

/** An office role reaches the people homed at a site it manages or nowhere; a supervisor those homed at a site it supervises (D8). Anyone else: nobody. */
function mayDecideFor(ctx: RosterCtx, home: string | null): boolean {
  if (ctx.access.scope === "all" && ctx.access.editPublished) return home === null || canSeeLocation(ctx.access, home)
  if (ctx.access.scope === "locations") return home !== null && canSeeLocation(ctx.access, home)
  return false
}

/** The same cut as SQL on the member's home location (the leave list and the notification audience follow it). */
export function approverReach(ctx: RosterCtx): SQL {
  const home = memberships.homeLocationId
  if (ctx.access.scope === "all" && ctx.access.editPublished) {
    const ids = ctx.access.locationIds ?? []
    return ids.length === 0 ? sql`${home} is null` : sql`(${home} is null or ${inScopeSql(ctx, home)})`
  }
  if (ctx.access.scope === "locations") return inScopeSql(ctx, home)
  return sql`false`
}

/** The deciders to tell: the home site's supervisors AND the office roles that cover it (a Roster Manager excepted from the site is not told), never the requester. */
async function decidersOf(tx: TenantTx, tenantId: string, home: string | null, requester: string): Promise<string[]> {
  const active = [eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), sql`${memberships.userId} <> ${requester}`, eq(roles.tenantId, tenantId), sql`${roles.access}->>'roster' = 'write'`]
  const sup = home
    ? await tx
        .select({ userId: memberships.userId })
        .from(locationSupervisors)
        .innerJoin(memberships, and(eq(memberships.tenantId, locationSupervisors.tenantId), eq(memberships.userId, locationSupervisors.userId)))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(locationSupervisors.tenantId, tenantId), eq(locationSupervisors.locationId, home), eq(roles.rosterLevel, "supervisor"), ...active))
    : []
  const office = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(
      and(
        eq(roles.rosterLevel, "office"), ...active,
        home ? notExists(tx.select({ one: sql`1` }).from(rosterOfficeLimits).where(and(eq(rosterOfficeLimits.tenantId, tenantId), eq(rosterOfficeLimits.userId, memberships.userId), eq(rosterOfficeLimits.locationId, home)))) : undefined,
      ),
    )
  return [...new Set([...sup, ...office].map((r) => r.userId))].sort()
}

/** POST /v1/leave (self): the caller's own request. Dates are whole days, inclusive. An overlap with the person's own open or approved leave is 409 leave_overlap. */
export async function createLeave(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, input: { from: string; to: string; kind: string; note?: string }): Promise<LeaveDto> {
  const kind = cleanText(input.kind, KIND_MAX)
  const note = cleanText(input.note, NOTE_MAX)
  if (!kind || note === null || !realDate(input.from) || !realDate(input.to) || input.to < input.from || dayCount(input.from, input.to) > MAX_SPAN_DAYS) throw unprocessable("invalid_leave")
  const [clash] = await tx
    .select({ id: leaveRequests.id })
    .from(leaveRequests)
    .where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.userId, ctx.me), inArray(leaveRequests.status, ["requested", "approved"]), lte(leaveRequests.fromDate, input.to), gte(leaveRequests.toDate, input.from)))
    .limit(1)
  if (clash) throw Conflict("leave_overlap")
  const [row] = await tx
    .insert(leaveRequests)
    .values({ tenantId: ctx.tenantId, userId: ctx.me, fromDate: input.from, toDate: input.to, kind, note, createdAt: ctx.now, updatedAt: ctx.now })
    .returning()
  const [m] = await tx.select({ home: memberships.homeLocationId }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, ctx.me)))
  for (const userId of await decidersOf(tx, ctx.tenantId, m?.home ?? null, ctx.me)) {
    // the requester is named through the subject token at read time (erasure-safe); no site name, no other person
    await notify(tx, ctx.tenantId, { userId, kind: "member", title: "Leave requested", body: `{{subject}} asked for leave from ${input.from} to ${input.to}.`, link: "/rosters", subjectUserId: ctx.me }, env.deps, env.enqueue)
  }
  await publishRoster(tx, ctx, "roster.leave_requested", { leaveId: row.id, userId: ctx.me })
  return view(row)
}

type Filter = { status?: string; userId?: string; from?: string; to?: string; limit?: string; cursor?: string }
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/** GET /v1/leave: the caller's own, plus (supervisor) people homed at their sites or (office) everyone within scope. Out of scope is simply absent. Newest first (created, then id), keyset cursor. */
export async function listLeave(tx: TenantTx, ctx: RosterCtx, q: Filter): Promise<{ items: LeaveDto[]; nextCursor: string | null }> {
  if ((q.status !== undefined && !(STATUSES as readonly string[]).includes(q.status)) || (q.from !== undefined && !realDate(q.from)) || (q.to !== undefined && !realDate(q.to))) throw unprocessable("invalid_filter")
  const limit = q.limit === undefined ? DEFAULT_LIMIT : /^\d{1,3}$/.test(q.limit) ? Number(q.limit) : 0
  if (limit < 1 || limit > MAX_LIMIT) throw unprocessable("invalid_filter")
  const after = q.cursor === undefined ? undefined : decodeCursor(q.cursor)
  const rows = await tx
    .select({ lr: leaveRequests })
    .from(leaveRequests)
    .innerJoin(memberships, and(eq(memberships.tenantId, leaveRequests.tenantId), eq(memberships.userId, leaveRequests.userId)))
    .where(
      and(
        eq(leaveRequests.tenantId, ctx.tenantId),
        or(eq(leaveRequests.userId, ctx.me), approverReach(ctx)),
        q.status ? eq(leaveRequests.status, q.status) : undefined,
        q.userId ? eq(leaveRequests.userId, q.userId) : undefined,
        q.from ? gte(leaveRequests.toDate, q.from) : undefined,
        q.to ? lte(leaveRequests.fromDate, q.to) : undefined,
        after ? or(lt(leaveRequests.createdAt, after.at), and(eq(leaveRequests.createdAt, after.at), lt(leaveRequests.id, after.id))) : undefined,
      ),
    )
    .orderBy(desc(leaveRequests.createdAt), desc(leaveRequests.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit).map((r) => r.lr)
  const last = page[page.length - 1]
  return { items: page.map(view), nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null }
}

/** The leave row, locked, with its person's home site; the SAME 404 for a non-uuid id, a missing one, another tenant's and one the caller may not see. */
async function lockLeave(tx: TenantTx, ctx: RosterCtx, id: string): Promise<{ row: Row; home: string | null }> {
  if (!isUuid(id)) throw notFound()
  const [r] = await tx
    .select({ lr: leaveRequests, home: memberships.homeLocationId })
    .from(leaveRequests)
    .innerJoin(memberships, and(eq(memberships.tenantId, leaveRequests.tenantId), eq(memberships.userId, leaveRequests.userId)))
    .where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.id, id)))
    .for("update", { of: leaveRequests })
  if (!r) throw notFound()
  return { row: r.lr, home: r.home }
}

/** POST /v1/leave/{id}/decide: approve or reject an open request. Never your own (403 self_decision); a person you may not decide for is a 404. */
export async function decideLeave(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, id: string, input: { decision: "approve" | "reject"; note?: string }): Promise<LeaveDto> {
  const note = cleanText(input.note, NOTE_MAX)
  if (note === null) throw unprocessable("invalid_leave")
  const { row, home } = await lockLeave(tx, ctx, id)
  if (row.userId === ctx.me) throw Forbidden("self_decision")
  if (!mayDecideFor(ctx, home)) throw notFound()
  if (row.status !== "requested") throw Conflict("already_decided")
  const status = input.decision === "approve" ? "approved" : "rejected"
  const [next] = await tx
    .update(leaveRequests)
    .set({ status, decidedBy: ctx.me, decidedAt: ctx.now, decisionNote: note === "" ? null : note, updatedAt: ctx.now })
    .where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.id, row.id)))
    .returning()
  await notify(
    tx, ctx.tenantId,
    { userId: row.userId, kind: "member", title: status === "approved" ? "Leave approved" : "Leave rejected", body: `Your leave from ${row.fromDate} to ${row.toDate} was ${status}.${note ? ` Note: ${note}` : ""}`, link: "/rosters" },
    env.deps, env.enqueue,
  )
  await auditRoster(tx, ctx, { action: "roster.leave_decided", entity: "leave_request", entityId: row.id, before: { status: row.status }, after: { status, decidedBy: ctx.me, userId: row.userId, from: row.fromDate, to: row.toDate } })
  await publishRoster(tx, ctx, "roster.leave_decided", { leaveId: row.id, userId: row.userId, decision: input.decision })
  return view(next)
}

/**
 * POST /v1/leave/{id}/cancel: the requester withdraws an open or approved request. Someone who can see it but did not ask: 403; who cannot: 404. A leave that has already started
 * (its first day is today or earlier in the person's site zone, else the tenant zone, on the injected clock) is 422 leave_started. Cancelling an APPROVED leave changes rostering,
 * so it tells the deciders, publishes roster.leave_cancelled and audits; a pending one is silent.
 */
export async function cancelLeave(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, id: string): Promise<LeaveDto> {
  const { row, home } = await lockLeave(tx, ctx, id)
  if (row.userId !== ctx.me) throw mayDecideFor(ctx, home) ? Forbidden("forbidden") : notFound()
  if (row.status !== "requested" && row.status !== "approved") throw Conflict("leave_not_open")
  const [site] = home ? await tx.select({ zone: locations.timeZone }).from(locations).where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, home))) : []
  const today = epochToWall(ctx.now.getTime(), site?.zone ?? ctx.tz).slice(0, 10)
  if (row.fromDate <= today) throw unprocessable("leave_started")
  const [next] = await tx.update(leaveRequests).set({ status: "cancelled", updatedAt: ctx.now }).where(and(eq(leaveRequests.tenantId, ctx.tenantId), eq(leaveRequests.id, row.id))).returning()
  if (row.status === "approved") {
    for (const userId of await decidersOf(tx, ctx.tenantId, home, ctx.me)) {
      await notify(tx, ctx.tenantId, { userId, kind: "member", title: "Approved leave cancelled", body: `{{subject}} cancelled approved leave from ${row.fromDate} to ${row.toDate}.`, link: "/rosters", subjectUserId: ctx.me }, env.deps, env.enqueue)
    }
    await auditRoster(tx, ctx, { action: "roster.leave_cancelled", entity: "leave_request", entityId: row.id, before: { status: row.status }, after: { status: "cancelled", userId: row.userId, from: row.fromDate, to: row.toDate } })
    await publishRoster(tx, ctx, "roster.leave_cancelled", { leaveId: row.id, userId: row.userId })
  }
  return view(next)
}

// ------------------------------------------------------------------ availability

const HM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/
type Win = { weekday: number; from: string; to: string }

/**
 * The set the person sent as stored rows. A window that crosses midnight (to before from) is split at midnight: [from, 24:00] on its weekday and [00:00, to]
 * on the next one; a `to` of 00:00 means 24:00. Anything malformed, `from` equal to `to`, or more than 50 distinct rows is invalid_availability.
 */
function split(input: Win[]): Win[] {
  const out = new Map<string, Win>()
  const put = (w: Win) => out.set(`${w.weekday}|${w.from}|${w.to}`, w)
  for (const w of input) {
    if (!Number.isInteger(w.weekday) || w.weekday < 0 || w.weekday > 6 || !HM.test(w.from) || !(HM.test(w.to) || w.to === "24:00")) throw unprocessable("invalid_availability")
    const to = w.to === "00:00" ? "24:00" : w.to
    if (to === w.from) throw unprocessable("invalid_availability")
    if (to > w.from) put({ weekday: w.weekday, from: w.from, to })
    else {
      put({ weekday: w.weekday, from: w.from, to: "24:00" })
      put({ weekday: (w.weekday + 1) % 7, from: "00:00", to })
    }
  }
  if (out.size > MAX_WINDOWS) throw unprocessable("invalid_availability")
  return [...out.values()].sort((a, b) => a.weekday - b.weekday || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
}

async function readWindows(tx: TenantTx, tenantId: string, userId: string): Promise<Win[]> {
  const rows = await tx
    .select({ weekday: rosterAvailability.weekday, from: rosterAvailability.fromTime, to: rosterAvailability.toTime })
    .from(rosterAvailability)
    .where(and(eq(rosterAvailability.tenantId, tenantId), eq(rosterAvailability.userId, userId)))
    .orderBy(asc(rosterAvailability.weekday), asc(rosterAvailability.fromTime), asc(rosterAvailability.toTime))
  return rows
}

/** GET /v1/roster/availability: the caller's own "not available" windows (overnight ones as the two stored rows). */
export async function getAvailability(tx: TenantTx, ctx: RosterCtx): Promise<AvailabilityDto> {
  return { windows: await readWindows(tx, ctx.tenantId, ctx.me) }
}

/** PUT /v1/roster/availability: replaces the caller's whole set in one transaction (a refused row rolls the delete back); an unchanged set writes nothing. */
export async function putAvailability(tx: TenantTx, ctx: RosterCtx, input: Win[]): Promise<AvailabilityDto> {
  const next = split(input)
  const old = await readWindows(tx, ctx.tenantId, ctx.me)
  if (JSON.stringify(old) === JSON.stringify(next)) return { windows: old }
  await tx.delete(rosterAvailability).where(and(eq(rosterAvailability.tenantId, ctx.tenantId), eq(rosterAvailability.userId, ctx.me)))
  if (next.length) await tx.insert(rosterAvailability).values(next.map((w) => ({ tenantId: ctx.tenantId, userId: ctx.me, weekday: w.weekday, fromTime: w.from, toTime: w.to })))
  return { windows: next }
}
