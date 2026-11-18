import { and, asc, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm"
import { canSeeLocation } from "@opsdesk/domain/roster-access"
import type { RuleViolation } from "@opsdesk/domain/roster-rules"
import { decodeCursor, encodeCursor } from "../../core/cursor"
import { Conflict, Forbidden, NotFound } from "../../core/errors"
import { locations, memberships, rosterExchanges, rosterShifts, rosterWeeks, shiftTypes } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { instantSql } from "./locations"
import type { ExchangeDto, ShiftDto } from "./dto"
import { approversOf, notifyActive, type Notice } from "./events"
import { announce, assertEligible, assertNoDuplicate, bumpWeek, guarded, loadShift, ruleGate, unprocessable, type Spec } from "./shifts"
import { canSeePerson, inScopeSql, type RosterCtx } from "./scope"
import { shiftDto, shiftSnap, type LoadedWeek, type ShiftRow } from "./weeks"
import { auditRoster, checkOverrideIds, cleanReason, isUuid, publishRoster, writeHistory, type RosterEnv } from "./write"

// Open shifts, claims and swaps (FR-RS-38, 42, 43; R8-11). One table, `roster_exchanges` (kind claim | swap). A CLAIM is a person asking for an open shift of a published, upcoming week at a site
// they are located at (homed there, or rostered at it that week); a SWAP is the person on a shift handing it over to a named colleague. Both stay requests until an approver decides:
//   - who may approve: a supervisor of the site or an office role in scope on a DRAFT week; on a PUBLISHED week only an office role, unless the location delegates (`swap_approval_delegated`),
//     then its supervisor too; staff never; nobody decides an exchange they are a party to or that is about their own shift (403 self_decision);
//   - a supervisor on a published week may RECOMMEND (requested -> recommended) when the location does not delegate;
//   - an approval runs eligibility and the rule engine AGAIN inside the roster write for the person who ends up on the shift; a block stops it (422 rule_blocked) unless an office role gives
//     `overrideReason` and (on a published week) names the rules in `overrideRuleIds`; a delegated supervisor can never override;
//   - the roster lock serialises everything, so two approvals of two claims of one shift have exactly one winner: the other is 409 shift_taken.
// An exchange whose shift has started is `expired` (read on the clock, nothing is swept): it can no longer be approved or recommended, only rejected or cancelled.

const exNotFound = () => NotFound("exchange_not_found")
const NOTE_MAX = 500
const STATUSES = ["requested", "recommended", "approved", "rejected", "cancelled"] as const
const OPEN = ["requested", "recommended"]
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const CONTROL = /[\u0000-\u001f\u007f]/

type Row = typeof rosterExchanges.$inferSelect
type ShiftBits = { weekId: string; locationId: string; date: string; startTime: string; endTime: string; startAt: Date }
const view = (r: Row, s: ShiftBits, now: Date): ExchangeDto => ({
  id: r.id, kind: r.kind as "claim" | "swap", shiftId: r.shiftId, weekId: s.weekId, locationId: s.locationId, date: s.date, start: s.startTime, end: s.endTime, fromUserId: r.fromUserId, toUserId: r.toUserId,
  status: r.status as ExchangeDto["status"], note: r.note, decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(),
  expired: OPEN.includes(r.status) && s.startAt.getTime() <= now.getTime(),
})
const bits = (s: ShiftRow): ShiftBits => ({ weekId: s.weekId, locationId: s.locationId, date: s.date, startTime: s.startTime, endTime: s.endTime, startAt: s.startAt })

const cleanNote = (v: string | undefined, code: string): string | null => {
  const t = (v ?? "").trim()
  if (t.length > NOTE_MAX || CONTROL.test(t.replace(/[\r\n\t]/g, " "))) throw unprocessable(code)
  return t === "" ? null : t
}

/** Whether a person is LOCATED at a site for a week: homed there, or rostered at it that week (a cross-site loan). The visibility of an open shift or of a colleague for someone with no location view (staff). */
async function locatedAt(tx: TenantTx, ctx: RosterCtx, userId: string, locationId: string, weekId: string): Promise<boolean> {
  const [m] = await tx.select({ home: memberships.homeLocationId }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, userId)))
  if (m?.home === locationId) return true
  const [s] = await tx.select({ id: rosterShifts.id }).from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.weekId, weekId), eq(rosterShifts.userId, userId))).limit(1)
  return !!s
}

/** The week then the shift locked FOR UPDATE for someone who may not have a location view (a claimer, a swapper): the caller has already decided they may know the shift. */
async function lockShiftOf(tx: TenantTx, ctx: RosterCtx, s: ShiftRow): Promise<{ cur: ShiftRow; loaded: LoadedWeek }> {
  const [w] = await tx
    .select({ w: rosterWeeks, zone: locations.timeZone, archivedAt: locations.archivedAt })
    .from(rosterWeeks)
    .innerJoin(locations, and(eq(locations.tenantId, rosterWeeks.tenantId), eq(locations.id, rosterWeeks.locationId)))
    .where(and(eq(rosterWeeks.tenantId, ctx.tenantId), eq(rosterWeeks.id, s.weekId)))
    .for("update", { of: rosterWeeks })
  const [cur] = await tx.select().from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, s.id))).for("update")
  if (!w || !cur) throw NotFound()
  return { cur, loaded: { week: w.w, zone: w.zone ?? ctx.tz, archived: w.archivedAt !== null } }
}

async function readShift(tx: TenantTx, ctx: RosterCtx, id: string): Promise<ShiftRow> {
  if (!isUuid(id)) throw NotFound()
  const [s] = await tx.select().from(rosterShifts).where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, id)))
  if (!s) throw NotFound()
  return s
}

/** What to tell the people who decide (office in scope, and the site's supervisors, who may recommend or, with delegation, decide) when something is asked; never the people it concerns. */
const askers = (tx: TenantTx, ctx: RosterCtx, locationId: string, exclude: string[]) => approversOf(tx, ctx.tenantId, locationId, { supervisors: true, exclude })

const MAX_OPEN_PER_PERSON = 5
const COOLDOWN_MS = 3_600_000

/** At most 5 open exchanges per requester (409 `too_many_open`): a loop of propose, cancel, propose cannot notify people for ever (AF2). */
async function assertRoom(tx: TenantTx, ctx: RosterCtx): Promise<void> {
  const open = await tx.select({ id: rosterExchanges.id }).from(rosterExchanges).where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.fromUserId, ctx.me), sql`${rosterExchanges.status} in ('requested','recommended')`)).limit(MAX_OPEN_PER_PERSON)
  if (open.length >= MAX_OPEN_PER_PERSON) throw Conflict("too_many_open")
}

/** The one place that says whether a week is shown to a caller: a DRAFT week is unknown to a member with no edit role (staff): the same 404 as a shift that does not exist (AF1). */
const unpublished = (ctx: RosterCtx): Error => (ctx.access.editDraft ? Conflict("week_not_published") : NotFound())

type Created = { exchange: ExchangeDto; created: boolean }

async function openExchange(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, cur: ShiftRow, kind: "claim" | "swap", toUserId: string | null, note: string | null, draft: boolean): Promise<ExchangeDto> {
  const [row] = await tx
    .insert(rosterExchanges)
    .values({ tenantId: ctx.tenantId, kind, shiftId: cur.id, fromUserId: ctx.me, toUserId, status: "requested", note: note ?? "", createdAt: ctx.now, updatedAt: ctx.now })
    .returning()
  await writeHistory(tx, ctx, { locationId: cur.locationId, weekId: cur.weekId, shiftId: cur.id, action: "exchange_requested", after: { exchangeId: row.id, kind, fromUserId: ctx.me, toUserId } })
  const to = await askers(tx, ctx, cur.locationId, [ctx.me, ...(toUserId ? [toUserId] : [])])
  const notices: Notice[] = to.map((userId) => ({
    userId, title: kind === "claim" ? "Shift claim requested" : "Shift swap requested", subjectUserId: ctx.me,
    body: kind === "claim" ? "{{subject}} asked to claim an open shift. Review it in the roster." : "{{subject}} asked to hand a shift over to a colleague. Review it in the roster.",
  }))
  // a draft week is not shown to anyone yet: the colleague hears nothing (R8-17)
  if (toUserId && !draft) notices.push({ userId: toUserId, title: "Shift swap requested", body: "{{subject}} wants to hand a shift over to you. A supervisor decides.", subjectUserId: ctx.me })
  await notifyActive(tx, ctx, env, notices)
  await auditRoster(tx, ctx, { action: "roster.exchange_requested", entity: "roster_exchange", entityId: row.id, before: null, after: { kind, shiftId: cur.id, locationId: cur.locationId, fromUserId: ctx.me, toUserId } })
  await publishRoster(tx, ctx, "roster.exchange_requested", { exchangeId: row.id, kind, shiftId: cur.id, weekId: cur.weekId, locationId: cur.locationId, fromUserId: ctx.me, toUserId })
  return view(row, bits(cur), ctx.now)
}

/**
 * POST /v1/roster/shifts/{id}/claim: the caller asks for an OPEN shift of a published, upcoming week at a site they are located at (a site they cannot see and are not located at is the plain
 * 404). Eligibility (left, a missing or expired required qualification) is 422 `ineligible`. The same open claim again is returned as it is (`created: false`, one row), so a double click
 * is harmless. 409 `week_not_published`, `shift_not_open`, `shift_started`, `location_archived`.
 */
export async function claimShift(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, shiftId: string): Promise<Created> {
  const seen = await readShift(tx, ctx, shiftId)
  if (!canSeeLocation(ctx.access, seen.locationId) && !(await locatedAt(tx, ctx, ctx.me, seen.locationId, seen.weekId))) throw NotFound()
  const { cur, loaded } = await lockShiftOf(tx, ctx, seen)
  if (loaded.week.status !== "published") throw unpublished(ctx)
  if (loaded.archived) throw Conflict("location_archived")
  if (cur.userId !== null) throw Conflict("shift_not_open")
  if (cur.startAt.getTime() <= ctx.now.getTime()) throw Conflict("shift_started")
  const [open] = await tx.select().from(rosterExchanges).where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.shiftId, cur.id), eq(rosterExchanges.fromUserId, ctx.me), eq(rosterExchanges.kind, "claim"), sql`${rosterExchanges.status} in ('requested','recommended')`))
  if (open) return { exchange: view(open, bits(cur), ctx.now), created: false }
  await assertRoom(tx, ctx)
  const [type] = await tx.select().from(shiftTypes).where(and(eq(shiftTypes.tenantId, ctx.tenantId), eq(shiftTypes.id, cur.shiftTypeId)))
  await assertEligible(tx, ctx, [{ userId: ctx.me, date: cur.date, type }])
  return { exchange: await openExchange(tx, ctx, env, cur, "claim", null, null, false), created: true }
}

/**
 * POST /v1/roster/shifts/{id}/swap (`{ toUserId, note? }`): the person on the shift hands it over to a named colleague. Only the person on the shift (someone else who sees it is 403, who does
 * not is the plain 404). The colleague must be known to the caller: homed at the shift's site, rostered there that week, or within the caller's scope: anyone else, missing or of another site,
 * is the same 404 `member_not_found` and nothing about them is said. 422 `invalid_swap` (yourself), `ineligible` (left or missing qualification, generic for a person the caller may not know),
 * 409 `exchange_open` (another open swap of the shift), `shift_started`, `location_archived`. The same open swap again is returned as it is.
 */
export async function swapShift(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, shiftId: string, input: { toUserId: string; note?: string }): Promise<Created> {
  const seen = await readShift(tx, ctx, shiftId)
  if (seen.userId !== ctx.me) throw canSeeLocation(ctx.access, seen.locationId) ? Forbidden("forbidden") : NotFound()
  const note = cleanNote(input.note, "invalid_note")
  const to = input.toUserId.trim()
  if (to === ctx.me) throw unprocessable("invalid_swap")
  const { cur, loaded } = await lockShiftOf(tx, ctx, seen)
  if (cur.userId !== ctx.me) throw NotFound() // handed on while we waited for the lock
  if (loaded.week.status !== "published" && !ctx.access.editDraft) throw NotFound() // staff do not know a draft exists (AF1)
  if (loaded.archived) throw Conflict("location_archived")
  if (cur.startAt.getTime() <= ctx.now.getTime()) throw Conflict("shift_started")
  const [target] = to.length > 0 && to.length <= 128 ? await tx.select({ home: memberships.homeLocationId }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.userId, to))) : []
  if (!target || !(canSeePerson(ctx, to, target.home) || target.home === cur.locationId || (await locatedAt(tx, ctx, to, cur.locationId, cur.weekId)))) throw NotFound("member_not_found")
  const [open] = await tx.select().from(rosterExchanges).where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.shiftId, cur.id), eq(rosterExchanges.fromUserId, ctx.me), eq(rosterExchanges.kind, "swap"), sql`${rosterExchanges.status} in ('requested','recommended')`))
  if (open) {
    if (open.toUserId !== to) throw Conflict("exchange_open")
    return { exchange: view(open, bits(cur), ctx.now), created: false }
  }
  await assertRoom(tx, ctx)
  // AF2: after a cancel or a refusal the same shift is not offered to the same colleague again for an hour (deps.clock)
  const [recent] = await tx
    .select({ id: rosterExchanges.id })
    .from(rosterExchanges)
    .where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.shiftId, cur.id), eq(rosterExchanges.fromUserId, ctx.me), eq(rosterExchanges.kind, "swap"), eq(rosterExchanges.toUserId, to), sql`${rosterExchanges.status} in ('rejected','cancelled')`, gt(rosterExchanges.updatedAt, instantSql(ctx.now.getTime() - COOLDOWN_MS) as unknown as Date)))
    .limit(1)
  if (recent) throw Conflict("cooldown")
  const [type] = await tx.select().from(shiftTypes).where(and(eq(shiftTypes.tenantId, ctx.tenantId), eq(shiftTypes.id, cur.shiftTypeId)))
  await assertEligible(tx, ctx, [{ userId: to, date: cur.date, type }])
  return { exchange: await openExchange(tx, ctx, env, cur, "swap", to, note, loaded.week.status !== "published"), created: true }
}

/** GET /v1/roster/exchanges?status=&shiftId=: what the caller is a party to, plus every exchange of the sites they see (a supervisor: their own; office: those in scope). Newest first, keyset cursor. */
export async function listExchanges(tx: TenantTx, ctx: RosterCtx, q: { status?: string; shiftId?: string; limit?: string; cursor?: string }): Promise<{ items: ExchangeDto[]; nextCursor: string | null }> {
  if (q.status !== undefined && !(STATUSES as readonly string[]).includes(q.status)) throw unprocessable("invalid_filter")
  if (q.shiftId !== undefined && !isUuid(q.shiftId)) throw unprocessable("invalid_filter")
  const limit = q.limit === undefined ? DEFAULT_LIMIT : /^\d{1,3}$/.test(q.limit) ? Number(q.limit) : 0
  if (limit < 1 || limit > MAX_LIMIT) throw unprocessable("invalid_filter")
  const after = q.cursor === undefined ? undefined : decodeCursor(q.cursor)
  const rows = await tx
    .select({ ex: rosterExchanges, shift: rosterShifts })
    .from(rosterExchanges)
    .innerJoin(rosterShifts, and(eq(rosterShifts.tenantId, rosterExchanges.tenantId), eq(rosterShifts.id, rosterExchanges.shiftId)))
    .where(
      and(
        eq(rosterExchanges.tenantId, ctx.tenantId),
        or(eq(rosterExchanges.fromUserId, ctx.me), eq(rosterExchanges.toUserId, ctx.me), inScopeSql(ctx, rosterShifts.locationId)),
        q.status ? eq(rosterExchanges.status, q.status) : undefined,
        q.shiftId ? eq(rosterExchanges.shiftId, q.shiftId) : undefined,
        after ? or(lt(rosterExchanges.createdAt, after.at), and(eq(rosterExchanges.createdAt, after.at), lt(rosterExchanges.id, after.id))) : undefined,
      ),
    )
    .orderBy(desc(rosterExchanges.createdAt), desc(rosterExchanges.id))
    .limit(limit + 1)
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return { items: page.map((r) => view(r.ex, bits(r.shift), ctx.now)), nextCursor: rows.length > limit && last ? encodeCursor(last.ex.createdAt, last.ex.id) : null }
}

/** The exchange with its shift, seen by an approver: another site's, a missing one's and a non-uuid id are the same 404 `exchange_not_found`. */
async function findForApprover(tx: TenantTx, ctx: RosterCtx, id: string): Promise<{ shiftId: string }> {
  if (!isUuid(id)) throw exNotFound()
  const [f] = await tx
    .select({ shiftId: rosterExchanges.shiftId, locationId: rosterShifts.locationId })
    .from(rosterExchanges)
    .innerJoin(rosterShifts, and(eq(rosterShifts.tenantId, rosterExchanges.tenantId), eq(rosterShifts.id, rosterExchanges.shiftId)))
    .where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.id, id)))
  if (!f || !canSeeLocation(ctx.access, f.locationId)) throw exNotFound()
  if (!ctx.access.editDraft) throw Forbidden("forbidden") // visible, but this role decides nothing
  return { shiftId: f.shiftId }
}

async function lockExchange(tx: TenantTx, ctx: RosterCtx, id: string): Promise<Row> {
  const [row] = await tx.select().from(rosterExchanges).where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.id, id))).for("update")
  if (!row) throw exNotFound()
  return row
}

const isParty = (r: Row, me: string, shift: ShiftRow): boolean => r.fromUserId === me || r.toUserId === me || shift.userId === me

/**
 * POST /v1/roster/exchanges/{id}/recommend: a supervisor (or an office role) on a PUBLISHED week, where the supervisor may not decide, passes the request on: requested -> recommended, once
 * (a repeat is a 200 that writes nothing). The office roles are told. On a draft week the approver decides directly (409 `week_not_published`). 409 `already_decided`, `exchange_expired`;
 * 403 `self_decision` for a party to it.
 */
export async function recommendExchange(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, id: string): Promise<ExchangeDto> {
  const { shiftId } = await findForApprover(tx, ctx, id)
  const { shift: cur, loaded } = await loadShift(tx, ctx, shiftId)
  const row = await lockExchange(tx, ctx, id)
  if (isParty(row, ctx.me, cur)) throw Forbidden("self_decision")
  if (!OPEN.includes(row.status)) throw Conflict("already_decided")
  if (row.status === "recommended") return view(row, bits(cur), ctx.now)
  if (loaded.week.status !== "published") throw Conflict("week_not_published")
  if (cur.startAt.getTime() <= ctx.now.getTime()) throw Conflict("exchange_expired")
  const [next] = await tx.update(rosterExchanges).set({ status: "recommended", updatedAt: ctx.now }).where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.id, row.id))).returning()
  await writeHistory(tx, ctx, { locationId: cur.locationId, weekId: cur.weekId, shiftId: cur.id, action: "exchange_recommended", before: { exchangeId: row.id, status: row.status }, after: { exchangeId: row.id, status: "recommended" } })
  const office = await approversOf(tx, ctx.tenantId, cur.locationId, { supervisors: false, exclude: [ctx.me, row.fromUserId, ...(row.toUserId ? [row.toUserId] : [])] })
  await notifyActive(tx, ctx, env, office.map((userId) => ({ userId, title: "Shift exchange recommended", body: "{{subject}} recommended a shift exchange for your decision.", subjectUserId: ctx.me })))
  await auditRoster(tx, ctx, { action: "roster.exchange_recommended", entity: "roster_exchange", entityId: row.id, before: { status: row.status }, after: { status: "recommended", shiftId: cur.id } })
  return view(next, bits(cur), ctx.now)
}

/**
 * POST /v1/roster/exchanges/{id}/cancel: the requester withdraws their own open exchange. Someone who can see it but did not ask is 403, who cannot see it 404. A decided or cancelled one is
 * 409 `already_decided`. Cancelling is allowed even after the shift has started (tidy-up).
 */
export async function cancelExchange(tx: TenantTx, ctx: RosterCtx, id: string): Promise<ExchangeDto> {
  if (!isUuid(id)) throw exNotFound()
  const [f] = await tx
    .select({ ex: rosterExchanges, shift: rosterShifts })
    .from(rosterExchanges)
    .innerJoin(rosterShifts, and(eq(rosterShifts.tenantId, rosterExchanges.tenantId), eq(rosterShifts.id, rosterExchanges.shiftId)))
    .where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.id, id)))
  const party = f && (f.ex.fromUserId === ctx.me || f.ex.toUserId === ctx.me)
  if (!f || !(party || canSeeLocation(ctx.access, f.shift.locationId))) throw exNotFound()
  const row = await lockExchange(tx, ctx, id)
  if (row.fromUserId !== ctx.me) throw Forbidden("forbidden")
  if (!OPEN.includes(row.status)) throw Conflict("already_decided")
  const [next] = await tx.update(rosterExchanges).set({ status: "cancelled", updatedAt: ctx.now }).where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.id, row.id))).returning()
  await writeHistory(tx, ctx, { locationId: f.shift.locationId, weekId: f.shift.weekId, shiftId: f.shift.id, action: "exchange_cancelled", before: { exchangeId: row.id, status: row.status }, after: { exchangeId: row.id, status: "cancelled" } })
  await auditRoster(tx, ctx, { action: "roster.exchange_cancelled", entity: "roster_exchange", entityId: row.id, before: { status: row.status }, after: { status: "cancelled", shiftId: f.shift.id } })
  return view(next, bits(f.shift), ctx.now)
}

/**
 * POST /v1/roster/exchanges/{id}/decline: the colleague a swap is offered to may refuse it (AF2): rejected, the requester is told (generic text, nothing on a draft week). Only the colleague:
 * anyone else who can see it is 403 (the requester cancels instead), who cannot is 404; a claim has no colleague. 409 `already_decided`. Starts the 1 hour cooldown for that offer.
 */
export async function declineExchange(tx: TenantTx, ctx: RosterCtx, env: RosterEnv, id: string): Promise<ExchangeDto> {
  if (!isUuid(id)) throw exNotFound()
  const [f] = await tx
    .select({ ex: rosterExchanges, shift: rosterShifts, status: rosterWeeks.status })
    .from(rosterExchanges)
    .innerJoin(rosterShifts, and(eq(rosterShifts.tenantId, rosterExchanges.tenantId), eq(rosterShifts.id, rosterExchanges.shiftId)))
    .innerJoin(rosterWeeks, and(eq(rosterWeeks.tenantId, rosterShifts.tenantId), eq(rosterWeeks.id, rosterShifts.weekId)))
    .where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.id, id)))
  const party = f && (f.ex.fromUserId === ctx.me || f.ex.toUserId === ctx.me)
  const draft = f?.status !== "published"
  if (!f || !(party || canSeeLocation(ctx.access, f.shift.locationId)) || (draft && !ctx.access.editDraft)) throw exNotFound()
  const row = await lockExchange(tx, ctx, id)
  if (row.kind !== "swap" || row.toUserId !== ctx.me) throw Forbidden("forbidden")
  if (!OPEN.includes(row.status)) throw Conflict("already_decided")
  const [next] = await tx.update(rosterExchanges).set({ status: "rejected", decidedBy: ctx.me, decidedAt: ctx.now, updatedAt: ctx.now }).where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.id, row.id))).returning()
  await writeHistory(tx, ctx, { locationId: f.shift.locationId, weekId: f.shift.weekId, shiftId: f.shift.id, action: "exchange_declined", before: { exchangeId: row.id, status: row.status }, after: { exchangeId: row.id, status: "rejected", declinedBy: ctx.me } })
  if (!draft) await notifyActive(tx, ctx, env, [{ userId: row.fromUserId, title: "Swap declined", body: "Your swap request was declined by the colleague." }])
  await auditRoster(tx, ctx, { action: "roster.exchange_declined", entity: "roster_exchange", entityId: row.id, before: { status: row.status }, after: { status: "rejected", shiftId: f.shift.id, declinedBy: ctx.me } })
  await publishRoster(tx, ctx, "roster.exchange_decided", { exchangeId: row.id, kind: row.kind, shiftId: f.shift.id, weekId: f.shift.weekId, locationId: f.shift.locationId, decision: "decline", fromUserId: row.fromUserId, toUserId: row.toUserId })
  return view(next, bits(f.shift), ctx.now)
}

/**
 * POST /v1/roster/exchanges/{id}/decide (`{ decision, note?, overrideReason?, overrideRuleIds? }`). See the header for who may. Order of answers: not visible 404 `exchange_not_found`; a role that edits
 * nothing 403 `forbidden`; a supervisor on a published week of a location that does not delegate 403 `roster_locked` (a rejection is a decision too); a party to the exchange or the person on the shift
 * 403 `self_decision`; already decided or cancelled 409 `already_decided`; an approval after the shift started 409 `exchange_expired`. An approval needs the shift in the state the exchange expects (a claim:
 * still open, else 409 `shift_taken`; a swap: still the requester's, else 409 `shift_changed`), the incoming person eligible (422 `ineligible`) and the rules to hold: a block is 422 `rule_blocked`
 * unless an office role gives `overrideReason` (and on a published week names the rules). The shift changes hands, its confirmation is cleared, history, audit, notices and events follow.
 */
export async function decideExchange(
  tx: TenantTx, ctx: RosterCtx, env: RosterEnv, id: string, input: { decision: "approve" | "reject"; note?: string; overrideReason?: string; overrideRuleIds?: string[] },
): Promise<{ exchange: ExchangeDto; shift: ShiftDto | null; violations: RuleViolation[] }> {
  const { shiftId } = await findForApprover(tx, ctx, id)
  const note = cleanNote(input.note, "invalid_decision")
  const overrideReason = cleanReason(input.overrideReason)
  const overrideIds = checkOverrideIds(input.overrideRuleIds)
  const { shift: cur, loaded } = await loadShift(tx, ctx, shiftId) // week FOR UPDATE, then the shift, then the exchange (one fixed order)
  const row = await lockExchange(tx, ctx, id)
  const [loc] = await tx.select({ delegated: locations.swapApprovalDelegated }).from(locations).where(and(eq(locations.tenantId, ctx.tenantId), eq(locations.id, cur.locationId)))
  const office = ctx.access.scope === "all" && ctx.access.editPublished
  if (loaded.week.status === "published" && !office && !loc?.delegated) throw Forbidden("roster_locked")
  if (isParty(row, ctx.me, cur)) throw Forbidden("self_decision")
  if (!OPEN.includes(row.status)) throw Conflict("already_decided")
  const approve = input.decision === "approve"
  let shift: ShiftDto | null = null
  let violations: RuleViolation[] = []
  let done: () => Promise<void> = async () => undefined
  let incoming: string | null = null
  let closed: Row[] = [] // the other open claims of a shift that has just been given away
  const draft = loaded.week.status !== "published"
  if (approve) {
    if (cur.startAt.getTime() <= ctx.now.getTime()) throw Conflict("exchange_expired")
    if (loaded.archived) throw Conflict("location_archived")
    if (row.kind === "claim") {
      if (cur.userId !== null) throw Conflict("shift_taken")
      incoming = row.fromUserId
    } else {
      if (cur.userId !== row.fromUserId) throw Conflict("shift_changed")
      incoming = row.toUserId
      if (incoming === null) throw Conflict("shift_changed") // the colleague is gone (erased)
    }
    const [type] = await tx.select().from(shiftTypes).where(and(eq(shiftTypes.tenantId, ctx.tenantId), eq(shiftTypes.id, cur.shiftTypeId)))
    await assertEligible(tx, ctx, [{ userId: incoming, date: cur.date, type }])
    const spec: Spec = { id: cur.id, date: cur.date, userId: incoming, type, role: cur.role, start: cur.startTime, end: cur.endTime, unpaidBreakMin: cur.unpaidBreakMin, startAt: cur.startAt.getTime(), endAt: cur.endAt.getTime() }
    await assertNoDuplicate(tx, ctx, loaded.week.id, [spec], cur.id)
    const gate = await ruleGate(tx, ctx, loaded.week, { dropShiftIds: [cur.id], add: [{ id: cur.id, date: cur.date, personId: incoming, shiftTypeId: type.id, start: cur.startTime, end: cur.endTime, unpaidBreakMin: cur.unpaidBreakMin }] }, { reason: overrideReason ?? undefined, overrideRuleIds: overrideIds })
    violations = gate.violations
    const [moved] = await guarded(() =>
      tx
        .update(rosterShifts)
        .set({ userId: incoming, confirmedAt: null, version: sql`${rosterShifts.version} + 1`, updatedAt: ctx.now }) // the new person confirms (R8-17)
        .where(and(eq(rosterShifts.tenantId, ctx.tenantId), eq(rosterShifts.id, cur.id)))
        .returning(),
    )
    await bumpWeek(tx, ctx, loaded.week)
    shift = shiftDto(moved)
    if (row.kind === "claim") {
      closed = await tx.select().from(rosterExchanges).where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.shiftId, cur.id), eq(rosterExchanges.kind, "claim"), ne(rosterExchanges.id, row.id), sql`${rosterExchanges.status} in ('requested','recommended')`)).orderBy(asc(rosterExchanges.id)).for("update")
      if (closed.length > 0) await tx.update(rosterExchanges).set({ status: "rejected", decidedBy: ctx.me, decidedAt: ctx.now, updatedAt: ctx.now }).where(and(eq(rosterExchanges.tenantId, ctx.tenantId), inArray(rosterExchanges.id, closed.map((c) => c.id))))
    }
    await writeHistory(tx, ctx, {
      locationId: cur.locationId, weekId: cur.weekId, shiftId: cur.id, action: "exchange_approved", reason: overrideReason ?? note, before: shiftSnap(cur),
      after: { ...shiftSnap(moved), exchangeId: row.id, kind: row.kind, ...(gate.overrides.length ? { overrides: gate.overrides } : {}) },
    })
    done = () => announce(tx, ctx, loaded.week, { action: "moved", shiftIds: [cur.id], userIds: [cur.userId, incoming].filter((u): u is string => u !== null) })
  } else {
    await writeHistory(tx, ctx, { locationId: cur.locationId, weekId: cur.weekId, shiftId: cur.id, action: "exchange_rejected", reason: note, before: { exchangeId: row.id, status: row.status }, after: { exchangeId: row.id, status: "rejected" } })
  }
  const status = approve ? "approved" : "rejected"
  const [next] = await tx
    .update(rosterExchanges)
    .set({ status, decidedBy: ctx.me, decidedAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(rosterExchanges.tenantId, ctx.tenantId), eq(rosterExchanges.id, row.id)))
    .returning()
  const what = row.kind === "claim" ? "Claim" : "Swap"
  const noteText = note ? ` Note: ${note}` : ""
  const notices: Notice[] = [{ userId: row.fromUserId, title: `${what} ${status}`, body: `Your ${what.toLowerCase()} request was ${status}.${approve && row.kind === "claim" ? " Please confirm the shift in your roster." : ""}${noteText}` }]
  if (approve && row.kind === "swap" && incoming) notices.push({ userId: incoming, title: `${what} ${status}`, body: `A shift was handed over to you. Please confirm it in your roster.${noteText}` })
  for (const c of closed) {
    await writeHistory(tx, ctx, { locationId: cur.locationId, weekId: cur.weekId, shiftId: cur.id, action: "exchange_rejected", reason: "The shift was assigned to someone else", before: { exchangeId: c.id, status: c.status }, after: { exchangeId: c.id, status: "rejected", autoRejected: true } })
    await auditRoster(tx, ctx, { action: "roster.exchange_decided", entity: "roster_exchange", entityId: c.id, before: { status: c.status }, after: { status: "rejected", kind: c.kind, shiftId: cur.id, fromUserId: c.fromUserId, autoRejected: true } })
    notices.push({ userId: c.fromUserId, title: "Claim rejected", body: "Your claim was rejected: the shift was assigned to someone else." })
  }
  if (!draft) await notifyActive(tx, ctx, env, notices) // a draft week is not shown to the people yet: nothing person-facing (R8-17)
  await auditRoster(tx, ctx, {
    action: "roster.exchange_decided", entity: "roster_exchange", entityId: row.id, before: { status: row.status, shiftUserId: cur.userId },
    after: { status, kind: row.kind, shiftId: cur.id, fromUserId: row.fromUserId, toUserId: row.toUserId, ...(approve ? { shiftUserId: incoming } : {}), ...(note ? { note } : {}), ...(approve && overrideReason ? { overrideReason } : {}) },
  })
  await done()
  await publishRoster(tx, ctx, "roster.exchange_decided", { exchangeId: row.id, kind: row.kind, shiftId: cur.id, weekId: cur.weekId, locationId: cur.locationId, decision: input.decision, fromUserId: row.fromUserId, toUserId: row.toUserId })
  return { exchange: view(next, bits(cur), ctx.now), shift, violations }
}
