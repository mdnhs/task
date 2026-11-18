import { and, asc, between, count, eq, gt, isNull, ne, or, sql } from "drizzle-orm"
import { addDays, wallToEpoch, weekStart as mondayOf } from "@opsdesk/domain/shifts"
import { AppError } from "../../core/errors"
import { leaveRequests, locations, memberQualifications, memberships, rosterChangeRequests, rosterShifts, rosterWeeks } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import type { CoverageDto } from "./dto-reads"
import { approverReach } from "./leave"
import { realDate, todayOf } from "./qualifications"
import { readRules } from "./rules"
import { assertLocation, inScopeSql, type RosterCtx } from "./scope"
import { weekDtos } from "./weeks"

// The roster read models (B8 Task 14): coverage per location and day (FR-RS-12) and the roster items of the attention feed, the dashboard count and Today. Everything is DERIVED from the roster
// tables at read time (F17: nothing is stored for a read model), cut by the caller's roster scope (`inScopeSql` / `approverReach`: a hidden site contributes no row and no count), and cached by
// the route under the tenant's stamp (F18), which every write busts. No text of an item carries free text of another person.

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const MAX_COVERAGE_DAYS = 62

// ------------------------------------------------------------------ coverage

/** GET /v1/roster/coverage?from=&to=&locationId=: per visible location and day inside the range: people, target, short, over and open shifts (draft and published weeks both; the staff cut is an empty list). */
export async function coverage(tx: TenantTx, ctx: RosterCtx, q: { from?: string; to?: string; locationId?: string }): Promise<CoverageDto> {
  const from = q.from ?? todayOf(ctx)
  const to = q.to ?? addDays(from, 6)
  if (!realDate(from) || !realDate(to) || to < from || Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > MAX_COVERAGE_DAYS * 86_400_000) throw unprocessable("invalid_range")
  if (q.locationId !== undefined) assertLocation(ctx, q.locationId)
  const pick = q.locationId ? eq(locations.id, q.locationId) : undefined
  const locs = await tx
    .select({ id: locations.id, name: locations.name, archived: locations.archivedAt })
    .from(locations)
    .where(and(eq(locations.tenantId, ctx.tenantId), inScopeSql(ctx, locations.id), pick))
    .orderBy(sql`lower(${locations.name})`, asc(locations.id))
  const weeks = locs.length
    ? await tx
        .select()
        .from(rosterWeeks)
        .where(and(eq(rosterWeeks.tenantId, ctx.tenantId), inScopeSql(ctx, rosterWeeks.locationId), q.locationId ? eq(rosterWeeks.locationId, q.locationId) : undefined, between(rosterWeeks.weekStart, mondayOf(from), to)))
        .orderBy(asc(rosterWeeks.weekStart), asc(rosterWeeks.id))
    : []
  const dtos = await weekDtos(tx, ctx, weeks)
  const open = new Map<string, number>()
  if (weeks.length) {
    const rows = await tx
      .select({ weekId: rosterShifts.weekId, date: sql<string>`${rosterShifts.date}::text`, n: count() })
      .from(rosterShifts)
      .where(and(eq(rosterShifts.tenantId, ctx.tenantId), isNull(rosterShifts.userId), sql`${rosterShifts.weekId} in (${sql.join(weeks.map((w) => sql`${w.id}`), sql`, `)})`))
      .groupBy(rosterShifts.weekId, rosterShifts.date)
    for (const r of rows) open.set(`${r.weekId}|${r.date}`, r.n)
  }
  const days = new Map<string, CoverageDto["locations"][number]["days"]>()
  weeks.forEach((w, i) => {
    const list = days.get(w.locationId) ?? []
    for (const d of dtos[i].days) {
      if (d.date < from || d.date > to) continue
      list.push({ date: d.date, weekId: w.id, status: w.status as "draft" | "published", staff: d.count, target: d.target, short: d.short, over: d.over, open: open.get(`${w.id}|${d.date}`) ?? 0 })
    }
    days.set(w.locationId, list)
  })
  return { from, to, locations: locs.filter((l) => !l.archived || (days.get(l.id)?.length ?? 0) > 0).map((l) => ({ locationId: l.id, name: l.name, days: days.get(l.id) ?? [] })) }
}

// ------------------------------------------------------------------ attention items

export const ROSTER_ATTENTION_KINDS = ["roster_open_shift", "roster_unconfirmed", "roster_change_request", "roster_leave", "qualification_expiring", "roster_draft_week"] as const
export type RosterAttentionKind = (typeof ROSTER_ATTENTION_KINDS)[number]
/** One roster line of the feed: `ref` is the id to open (shift, request, leave, week, or the person for a licence). */
export type RosterAttentionItem = { kind: RosterAttentionKind; ref: string; title: string; ownerId: string | null; /** A Date from a row, or epoch ms for a day start. */ dueAt: Date | number; reason: string; key: string }
/** Most items of one roster kind in the feed (`total` still counts all of them). */
export const ROSTER_ATTENTION_CAP = 100
/** An expiring licence is an item from this many days before its expiry to this many days after it. */
export const EXPIRY_ATTENTION_DAYS = 30
const OPEN_SHIFT_DAYS = 7
const DRAFT_LOOKBACK_DAYS = 6

type Kind = { kind: RosterAttentionKind; applies: boolean; count: () => Promise<number>; rows: (limit: number) => Promise<RosterAttentionItem[]> }

/** The instant (epoch ms) a calendar day starts in `tz`: a number, never a Date built here (this module reads the clock from deps only). */
const dayStart = (date: string, tz: string): number => wallToEpoch(`${date}T00:00`, tz)
const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? "" : "s"}`
const span = (s: { date: string; start: string; end: string }): string => `${s.date} ${s.start}-${s.end}`
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** The roster kinds this caller can have items of. A kind that does not apply costs no statement. */
function kinds(tx: TenantTx, ctx: RosterCtx): Kind[] {
  const today = todayOf(ctx)
  const office = ctx.access.scope === "all" && ctx.access.editPublished
  const sees = (ctx.access.locationIds?.length ?? 0) > 0
  const reach = ctx.access.scope === "locations" ? sees : office
  const s = rosterShifts
  const w = rosterWeeks
  const l = locations
  const published = and(eq(w.tenantId, s.tenantId), eq(w.id, s.weekId), eq(w.status, "published"))

  const openWhere = and(eq(s.tenantId, ctx.tenantId), isNull(s.userId), between(s.date, today, addDays(today, OPEN_SHIFT_DAYS)), gt(s.endAt, ctx.now), isNull(l.archivedAt), inScopeSql(ctx, s.locationId))
  const openBase = () => tx.select({ s, name: l.name }).from(s).innerJoin(w, published).innerJoin(l, and(eq(l.tenantId, s.tenantId), eq(l.id, s.locationId)))
  const open: Kind = {
    kind: "roster_open_shift", applies: sees,
    count: async () => (await tx.select({ n: count() }).from(s).innerJoin(w, published).innerJoin(l, and(eq(l.tenantId, s.tenantId), eq(l.id, s.locationId))).where(openWhere))[0].n,
    rows: async (limit) => (await openBase().where(openWhere).orderBy(asc(s.startAt), asc(s.id)).limit(limit)).map((r) => ({
      kind: "roster_open_shift", ref: r.s.id, title: `Open shift on ${span({ date: r.s.date, start: r.s.startTime, end: r.s.endTime })} at ${r.name}`, ownerId: null, dueAt: r.s.startAt, reason: "Nobody assigned", key: r.s.id,
    })),
  }

  const mineWhere = and(eq(s.tenantId, ctx.tenantId), eq(s.userId, ctx.me), isNull(s.confirmedAt), gt(s.endAt, ctx.now))
  const unconfirmed: Kind = {
    kind: "roster_unconfirmed", applies: true,
    count: async () => (await tx.select({ n: count() }).from(s).innerJoin(w, published).where(mineWhere))[0].n,
    rows: async (limit) => (await tx.select({ s, name: l.name }).from(s).innerJoin(w, published).innerJoin(l, and(eq(l.tenantId, s.tenantId), eq(l.id, s.locationId))).where(mineWhere).orderBy(asc(s.startAt), asc(s.id)).limit(limit)).map((r) => ({
      kind: "roster_unconfirmed", ref: r.s.id, title: `Confirm your shift on ${span({ date: r.s.date, start: r.s.startTime, end: r.s.endTime })} at ${r.name}`, ownerId: ctx.me, dueAt: r.s.startAt, reason: "Not confirmed yet", key: r.s.id,
    })),
  }

  const cr = rosterChangeRequests
  const crWhere = and(eq(cr.tenantId, ctx.tenantId), eq(cr.status, "requested"), ne(cr.requestedBy, ctx.me), or(isNull(s.userId), ne(s.userId, ctx.me)), isNull(l.archivedAt), inScopeSql(ctx, s.locationId))
  const crBase = () => tx.select({ cr, s, name: l.name }).from(cr).innerJoin(s, and(eq(s.tenantId, cr.tenantId), eq(s.id, cr.shiftId))).innerJoin(l, and(eq(l.tenantId, s.tenantId), eq(l.id, s.locationId)))
  const changes: Kind = {
    kind: "roster_change_request", applies: office && sees,
    count: async () => (await tx.select({ n: count() }).from(cr).innerJoin(s, and(eq(s.tenantId, cr.tenantId), eq(s.id, cr.shiftId))).innerJoin(l, and(eq(l.tenantId, s.tenantId), eq(l.id, s.locationId))).where(crWhere))[0].n,
    rows: async (limit) => (await crBase().where(crWhere).orderBy(asc(cr.createdAt), asc(cr.id)).limit(limit)).map((r) => ({
      kind: "roster_change_request", ref: r.cr.id, title: `Change request for the shift on ${r.s.date} at ${r.name}`, ownerId: r.cr.requestedBy, dueAt: r.cr.createdAt, reason: "Waiting for a decision", key: r.cr.id,
    })),
  }

  const lr = leaveRequests
  const leaveWhere = and(eq(lr.tenantId, ctx.tenantId), eq(lr.status, "requested"), ne(lr.userId, ctx.me), eq(memberships.status, "active"), approverReach(ctx))
  const leaveBase = () => tx.select({ lr }).from(lr).innerJoin(memberships, and(eq(memberships.tenantId, lr.tenantId), eq(memberships.userId, lr.userId)))
  const leave: Kind = {
    kind: "roster_leave", applies: reach,
    count: async () => (await tx.select({ n: count() }).from(lr).innerJoin(memberships, and(eq(memberships.tenantId, lr.tenantId), eq(memberships.userId, lr.userId))).where(leaveWhere))[0].n,
    rows: async (limit) => (await leaveBase().where(leaveWhere).orderBy(asc(lr.createdAt), asc(lr.id)).limit(limit)).map((r) => ({
      kind: "roster_leave", ref: r.lr.id, title: `Leave request ${r.lr.fromDate} to ${r.lr.toDate}`, ownerId: r.lr.userId, dueAt: r.lr.createdAt, reason: "Waiting for a decision", key: r.lr.id,
    })),
  }

  const mq = memberQualifications
  const expiryWhere = and(
    eq(mq.tenantId, ctx.tenantId), eq(memberships.status, "active"), between(mq.expiresOn, addDays(today, -EXPIRY_ATTENTION_DAYS), addDays(today, EXPIRY_ATTENTION_DAYS)),
    or(isNull(memberships.homeLocationId), inScopeSql(ctx, memberships.homeLocationId)),
  )
  const expiry: Kind = {
    kind: "qualification_expiring", applies: office,
    count: async () => (await tx.select({ n: count() }).from(mq).innerJoin(memberships, and(eq(memberships.tenantId, mq.tenantId), eq(memberships.userId, mq.userId))).where(expiryWhere))[0].n,
    rows: async (limit) => (await tx.select({ q: mq }).from(mq).innerJoin(memberships, and(eq(memberships.tenantId, mq.tenantId), eq(memberships.userId, mq.userId))).where(expiryWhere).orderBy(asc(mq.expiresOn), asc(mq.userId), asc(mq.type)).limit(limit)).map((r) => {
      const date = r.q.expiresOn!
      const left = daysBetween(today, date)
      return {
        kind: "qualification_expiring", ref: r.q.userId, title: `${r.q.type} ${left < 0 ? "expired" : "expires"} on ${date}`, ownerId: r.q.userId, dueAt: dayStart(date, ctx.tz),
        reason: left < 0 ? `Expired ${plural(-left, "day")} ago` : left === 0 ? "Expires today" : `Expires in ${plural(left, "day")}`, key: `${r.q.userId}|${r.q.type}|${date}`,
      }
    }),
  }

  const draftWhere = (warn: number) => and(eq(w.tenantId, ctx.tenantId), eq(w.status, "draft"), between(w.weekStart, addDays(today, -DRAFT_LOOKBACK_DAYS), addDays(today, warn)), isNull(l.archivedAt), inScopeSql(ctx, w.locationId))
  const draftBase = () => tx.select({ w, name: l.name }).from(w).innerJoin(l, and(eq(l.tenantId, w.tenantId), eq(l.id, w.locationId)))
  let draftWarn: Promise<number> | undefined // one rules read per request: count() and rows() share it
  const warnDays = () => (draftWarn ??= readRules(tx, ctx.tenantId).then((r) => r.draftWarnDays))
  const drafts: Kind = {
    kind: "roster_draft_week", applies: ctx.access.editDraft && sees,
    count: async () => {
      const draftWarnDays = await warnDays()
      return (await tx.select({ n: count() }).from(w).innerJoin(l, and(eq(l.tenantId, w.tenantId), eq(l.id, w.locationId))).where(draftWhere(draftWarnDays)))[0].n
    },
    rows: async (limit) => {
      const draftWarnDays = await warnDays()
      return (await draftBase().where(draftWhere(draftWarnDays)).orderBy(asc(w.weekStart), asc(w.id)).limit(limit)).map((r) => {
        const ahead = daysBetween(today, r.w.weekStart)
        return {
          kind: "roster_draft_week", ref: r.w.id, title: `Roster for the week of ${r.w.weekStart} at ${r.name} is still a draft`, ownerId: null, dueAt: dayStart(r.w.weekStart, ctx.tz),
          reason: ahead < 0 ? `Started ${plural(-ahead, "day")} ago` : ahead === 0 ? "Starts today" : `Starts in ${plural(ahead, "day")}`, key: r.w.id,
        } satisfies RosterAttentionItem
      })
    },
  }
  return [leave, changes, open, drafts, expiry, unconfirmed].filter((k) => k.applies)
}

/** The roster items of the attention feed for this caller: at most ROSTER_ATTENTION_CAP of each kind, `total` counts every one (a count statement only when a kind overflows). */
export async function loadRosterAttention(tx: TenantTx, ctx: RosterCtx): Promise<{ total: number; items: RosterAttentionItem[] }> {
  const items: RosterAttentionItem[] = []
  let total = 0
  for (const k of kinds(tx, ctx)) {
    const rows = await k.rows(ROSTER_ATTENTION_CAP + 1)
    total += rows.length > ROSTER_ATTENTION_CAP ? await k.count() : rows.length
    items.push(...rows.slice(0, ROSTER_ATTENTION_CAP))
  }
  return { total, items }
}

/** The number of roster items (the dashboard's attention count): one count statement per kind that applies, no rows. */
export async function countRosterAttention(tx: TenantTx, ctx: RosterCtx): Promise<number> {
  let total = 0
  for (const k of kinds(tx, ctx)) total += await k.count()
  return total
}

/** How many upcoming shifts of the caller's own are not confirmed (Today): one statement. */
export async function countUnconfirmed(tx: TenantTx, ctx: RosterCtx): Promise<number> {
  const k = kinds(tx, ctx).find((x) => x.kind === "roster_unconfirmed")!
  return k.count()
}

/**
 * How many open shifts the caller could claim (Today, for plain staff who have no attention feed): shifts nobody holds, on PUBLISHED weeks, from now to OPEN_SHIFT_DAYS ahead, at a site that is not
 * archived and where the caller is LOCATED, the claim rule (AF1): homed there, or rostered at it that week. Another site's, a draft week's and an ended shift's are not counted. One statement.
 */
export async function countOpenShiftsForMe(tx: TenantTx, ctx: RosterCtx): Promise<number> {
  const today = todayOf(ctx)
  const s = rosterShifts
  const w = rosterWeeks
  const l = locations
  const located = or(
    sql`${s.locationId} = (select ${memberships.homeLocationId} from ${memberships} where ${memberships.tenantId} = ${ctx.tenantId} and ${memberships.userId} = ${ctx.me})`,
    sql`exists (select 1 from roster_shifts mine where mine.tenant_id = ${s.tenantId} and mine.week_id = ${s.weekId} and mine.user_id = ${ctx.me})`,
  )
  const [r] = await tx
    .select({ n: count() })
    .from(s)
    .innerJoin(w, and(eq(w.tenantId, s.tenantId), eq(w.id, s.weekId), eq(w.status, "published")))
    .innerJoin(l, and(eq(l.tenantId, s.tenantId), eq(l.id, s.locationId)))
    .where(and(eq(s.tenantId, ctx.tenantId), isNull(s.userId), between(s.date, today, addDays(today, OPEN_SHIFT_DAYS)), gt(s.endAt, ctx.now), isNull(l.archivedAt), located))
  return r.n
}
