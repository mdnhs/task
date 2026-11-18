import { and, asc, desc, eq, gte, inArray, isNotNull, lt, lte, or, sql, type SQL } from "drizzle-orm"
import { withholdDriveText } from "@opsdesk/domain/devices"
import { dueInstant, epochToWall } from "@opsdesk/domain/shifts"
import { AppError } from "../../core/errors"
import { shiftReportItems, shiftReports, teams } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { loadReportingMaps, occurrencesBetween, reportDueAfterMinutes, reportingFrom } from "../shifts"
import { namesOf } from "../tasks"
import { INBOX_DEFAULT_DAYS, INBOX_MAX_DAYS, type InboxItemDto, type InboxStatus } from "./dto"
import { reportScopeWhere, type ReportCtx } from "./scope"
import { stateOf } from "./view"

/** What the scope predicate needs: who is "me", the report access and, for a team manager, the direct reports (ruling F5). */
export type InboxScope = Pick<ReportCtx, "access" | "reports" | "me">
export type InboxFilter = { from: string; to: string; team?: string; person?: string; status: InboxStatus; after?: Cursor }
type Cursor = { date: string; userId: string; patternId: string }

const DAY_MS = 86_400_000
const dayNum = (d: string): number => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))) / DAY_MS
const dateOf = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10)
const invalidCursor = () => new AppError(400, "invalid_cursor", "Bad Request")

/** Opaque keyset cursor: base64url of `<date>|<user id>|<pattern id>` (the key of the last row of the page: virtual rows have no id). Anything else is 400 invalid_cursor. */
export const encodeInboxCursor = (c: Cursor): string => Buffer.from(`${c.date}|${c.userId}|${c.patternId.toLowerCase()}`, "utf8").toString("base64url")
export function decodeInboxCursor(raw: string): Cursor {
  const s = Buffer.from(raw, "base64url").toString("utf8")
  const first = s.indexOf("|")
  const last = s.lastIndexOf("|")
  if (first <= 0 || last <= first + 1) throw invalidCursor()
  const c = { date: s.slice(0, first), userId: s.slice(first + 1, last), patternId: s.slice(last + 1).toLowerCase() } // lowercase hex: the SQL (uuid) and the JS string comparisons must agree
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.date) || dateOf(dayNum(c.date)) !== c.date || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.patternId)) throw invalidCursor()
  return c
}

/** The window: `from`/`to` default to the last 7 tenant-local days; at most 31 days (422 range_too_long), not backwards (422 invalid_range). */
export function inboxRange(now: Date, tz: string, q: { from?: string; to?: string }): { from: string; to: string } {
  const today = epochToWall(now.getTime(), tz).slice(0, 10)
  const to = q.to ?? (q.from && q.from > today ? q.from : today)
  const from = q.from ?? dateOf(dayNum(to) - (INBOX_DEFAULT_DAYS - 1))
  if (from > to) throw new AppError(422, "invalid_range", "Unprocessable Entity")
  if (dayNum(to) - dayNum(from) + 1 > INBOX_MAX_DAYS) throw new AppError(422, "range_too_long", "Unprocessable Entity")
  return { from, to }
}

/** Rows come back (shift_date desc, user id, pattern id). The user id is compared in the "C" collation on BOTH sides (SQL here, JS for the virtual rows) so the two streams merge in one order. */
const userC = sql`${shiftReports.userId} collate "C"`

/** The state filter in SQL, the same rules as `stateOf` (instants and `now`; `late` = FIRST submission after the due time). */
export function stateWhere(status: InboxStatus, now: Date): SQL | undefined {
  switch (status) {
    case "all": return undefined
    case "draft": return and(eq(shiftReports.status, "draft"), gte(shiftReports.dueAt, now))
    case "missing": return and(eq(shiftReports.status, "draft"), lt(shiftReports.dueAt, now))
    case "late": return and(eq(shiftReports.status, "submitted"), sql`${shiftReports.firstSubmittedAt} > ${shiftReports.dueAt}`)
    case "submitted": return and(eq(shiftReports.status, "submitted"), sql`${shiftReports.firstSubmittedAt} <= ${shiftReports.dueAt}`)
    default: return eq(shiftReports.status, status)
  }
}

const afterWhere = (a: Cursor): SQL | undefined =>
  or(lt(shiftReports.shiftDate, a.date), and(eq(shiftReports.shiftDate, a.date), or(sql`${userC} > ${a.userId} collate "C"`, and(sql`${userC} = ${a.userId} collate "C"`, sql`${shiftReports.patternId} > ${a.patternId}::uuid`))))

/**
 * The stored rows of the inbox (no free text is selected): in the caller's scope (`reportScopeWhere`: the ONLY scope rule, so a `person` or `team` filter can only narrow it), in the date window,
 * one keyset page. Exported so the EXPLAIN test plans exactly this statement: `shift_reports_inbox_idx` (all scope) or `shift_reports_user_idx` (own / team scope).
 * Reports whose member was erased (`user_id` null) are not in the inbox: they are reachable by id and counted by the dashboards, not listed as someone's.
 */
export function buildInboxQuery(tx: TenantTx, tenantId: string, scope: InboxScope, f: InboxFilter, now: Date, limit: number) {
  return tx
    .select({
      id: shiftReports.id, userId: shiftReports.userId, patternId: shiftReports.patternId, teamId: shiftReports.teamId, shiftName: shiftReports.shiftName, shiftDate: shiftReports.shiftDate,
      startAt: shiftReports.startAt, endAt: shiftReports.endAt, dueAt: shiftReports.dueAt, status: shiftReports.status, firstSubmittedAt: shiftReports.firstSubmittedAt,
      version: shiftReports.version, submissions: shiftReports.submissions, submittedAt: shiftReports.submittedAt, reviewedAt: shiftReports.reviewedAt, reviewedBy: shiftReports.reviewedBy,
    })
    .from(shiftReports)
    .where(and(inboxWhere(tenantId, scope, f), stateWhere(f.status, now), f.after ? afterWhere(f.after) : undefined))
    .orderBy(desc(shiftReports.shiftDate), asc(userC), asc(shiftReports.patternId))
    .limit(limit)
}

/** The rows of the window in the caller's scope under the team and person filters: what the list and the counts have in common (never the status or the cursor). */
const inboxWhere = (tenantId: string, scope: InboxScope, f: Pick<InboxFilter, "from" | "to" | "team" | "person">): SQL | undefined =>
  and(
    eq(shiftReports.tenantId, tenantId),
    gte(shiftReports.shiftDate, f.from), lte(shiftReports.shiftDate, f.to),
    isNotNull(shiftReports.userId),
    reportScopeWhere(scope),
    f.team ? eq(shiftReports.teamId, f.team) : undefined,
    f.person ? eq(shiftReports.userId, f.person) : undefined,
  )

export type InboxCounts = { all: number; open: number; missing: number; late: number; returned: number; accepted: number }

/**
 * The tab counts of the window: how many items each state has under the SAME scope, window, team and person filters as the list (not the status filter, not the cursor), so a count equals the length of
 * the list it opens. ONE aggregate statement over the stored rows (`filter (where ...)` with the states of `stateWhere`), plus the shifts nobody reported on yet (virtual rows: `missing` past their
 * due time, `open` before it), which the same scope cut produced. `open` = a draft not yet due + a report submitted on time and not yet reviewed; the five parts add up to `all`.
 */
export async function inboxCounts(tx: TenantTx, ctx: ReportCtx, f: InboxFilter): Promise<InboxCounts> {
  const n = (w: SQL | undefined) => (w ? sql<number>`(count(*) filter (where ${w}))::int` : sql<number>`count(*)::int`)
  const [row] = await tx
    .select({
      all: n(undefined), draft: n(stateWhere("draft", ctx.now)), submitted: n(stateWhere("submitted", ctx.now)), missing: n(stateWhere("missing", ctx.now)), late: n(stateWhere("late", ctx.now)),
      returned: n(stateWhere("returned", ctx.now)), accepted: n(stateWhere("accepted", ctx.now)),
    })
    .from(shiftReports)
    .where(inboxWhere(ctx.tenantId, ctx, f))
  let virtualOpen = 0
  let virtualMissing = 0
  const nowMs = ctx.now.getTime()
  for (const v of await virtualRows(tx, ctx, { ...f, status: "all", after: undefined }, Number.MAX_SAFE_INTEGER)) (nowMs > v.dueAt.getTime() ? virtualMissing++ : virtualOpen++)
  const open = row.draft + row.submitted + virtualOpen
  const missing = row.missing + virtualMissing
  return { all: open + missing + row.late + row.returned + row.accepted, open, missing, late: row.late, returned: row.returned, accepted: row.accepted }
}

const minutes = (ms: number): number => Math.max(0, Math.floor(ms / 60_000))

type Row = Awaited<ReturnType<typeof buildInboxQuery>>[number]
/** The key of a row for ordering and cursors. */
type Key = { date: string; userId: string; patternId: string }
const cmp = (a: Key, b: Key): number => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.userId !== b.userId ? (a.userId < b.userId ? -1 : 1) : a.patternId < b.patternId ? -1 : a.patternId > b.patternId ? 1 : 0)
const after = (k: Key, c: Cursor): boolean => cmp(k, c) > 0

type Virtual = Key & { teamId: string; shiftName: string; startAt: Date; endAt: Date; dueAt: Date }

/**
 * Shifts that are assigned, reported on and STARTED but have no report row yet (ruling F4): `missing` once past their due time, `draft` before. Scope applies here exactly as to stored rows
 * (a member list built from the same access, intersected with `person`). The stored keys of each chunk (whatever their state) are excluded, so a row is never shown twice. A page needs only
 * the first `limit + 1` rows of the newest-first stream, so the window is walked from its newest day down in chunks of 3 days and stops as soon as enough rows are in hand (a first page of a
 * 250-member, 31-day window costs one or two chunks, not thirty-one days).
 */
const CHUNK_DAYS = 3
export async function virtualRows(tx: TenantTx, ctx: ReportCtx, f: InboxFilter, limit: number): Promise<Virtual[]> {
  let people: string[] | undefined = ctx.access.kind === "all" ? undefined : ctx.access.kind === "own" ? [ctx.access.personId] : [ctx.access.managerId, ...ctx.reports]
  if (f.person) people = people ? people.filter((p) => p === f.person) : [f.person]
  if (people && people.length === 0) return []
  const maps = await loadReportingMaps(tx, ctx.tenantId)
  const mins = await reportDueAfterMinutes(tx, ctx.tenantId)
  const now = ctx.now.getTime()
  const out: Virtual[] = []
  let hi = f.after && f.after.date < f.to ? f.after.date : f.to // rows after the cursor are on or before its date
  while (hi >= f.from && out.length < limit) {
    const lo = dateOf(Math.max(dayNum(f.from), dayNum(hi) - (CHUNK_DAYS - 1)))
    const occ = await occurrencesBetween(tx, ctx.tenantId, ctx.tz, lo, hi, { userIds: people })
    if (occ.length > 0) {
      const keys = await tx
        .select({ u: shiftReports.userId, p: shiftReports.patternId, d: shiftReports.shiftDate })
        .from(shiftReports)
        .where(and(eq(shiftReports.tenantId, ctx.tenantId), gte(shiftReports.shiftDate, lo), lte(shiftReports.shiftDate, hi), reportScopeWhere(ctx), f.person ? eq(shiftReports.userId, f.person) : undefined))
      const have = new Set(keys.map((k) => `${k.u}|${k.p}|${k.d}`))
      const chunk: Virtual[] = []
      for (const o of occ) {
        if (o.startAt.getTime() > now || (f.team && o.teamId !== f.team) || !reportingFrom(maps, o.userId, o.teamId) || have.has(`${o.userId}|${o.patternId}|${o.shiftDate}`)) continue
        const dueAt = new Date(dueInstant(o.endAt.getTime(), mins))
        const missing = now > dueAt.getTime()
        if ((f.status === "draft" && missing) || (f.status === "missing" && !missing)) continue
        chunk.push({ date: o.shiftDate, userId: o.userId, patternId: o.patternId, teamId: o.teamId, shiftName: o.name, startAt: o.startAt, endAt: o.endAt, dueAt })
      }
      out.push(...chunk.filter((v) => !f.after || after(v, f.after)).sort(cmp))
    }
    hi = dateOf(dayNum(lo) - 1)
  }
  return out
}

/** GET /v1/shift-reports: stored and virtual rows of the window in ONE ordered stream, one keyset page (limit + 1 of each, merged), scope applied to both. */
export async function inboxPage(tx: TenantTx, ctx: ReportCtx, f: InboxFilter, limit: number): Promise<{ items: InboxItemDto[]; nextCursor: string | null; counts: InboxCounts }> {
  const stored: Row[] = await buildInboxQuery(tx, ctx.tenantId, ctx, f, ctx.now, limit + 1)
  let virtual: Virtual[] = []
  if (f.status === "all" || f.status === "draft" || f.status === "missing") {
    virtual = (await virtualRows(tx, ctx, f, limit + 1)).slice(0, limit + 1)
  }
  type Entry = { key: Key; row?: Row; virtual?: Virtual }
  const merged: Entry[] = [
    ...stored.map((row): Entry => ({ key: { date: row.shiftDate, userId: row.userId!, patternId: row.patternId }, row })),
    ...virtual.map((v): Entry => ({ key: v, virtual: v })),
  ].sort((a, b) => cmp(a.key, b.key))
  const page = merged.slice(0, limit)
  const more = merged.length > limit
  const last = page[page.length - 1]

  // labels and counts for this page only: one query per table
  const ids = page.flatMap((e) => (e.row ? [e.row.id] : []))
  const counts = ids.length
    ? await tx
        .select({ reportId: shiftReportItems.reportId, n: sql<number>`count(*)::int`, done: sql<number>`count(*) filter (where ${shiftReportItems.status} = 'done')::int` })
        .from(shiftReportItems)
        .where(and(eq(shiftReportItems.tenantId, ctx.tenantId), inArray(shiftReportItems.reportId, ids)))
        .groupBy(shiftReportItems.reportId)
    : []
  const countOf = new Map(counts.map((c) => [c.reportId, c]))
  const teamIds = [...new Set(page.map((e) => (e.row ? e.row.teamId : e.virtual!.teamId)))]
  const teamRows = teamIds.length ? await tx.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, ctx.tenantId), inArray(teams.id, teamIds))) : []
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]))
  const nameOf = await namesOf(tx, page.flatMap((e) => [e.key.userId, ...(e.row?.reviewedBy ? [e.row.reviewedBy] : [])]))
  const free = (s: string) => (ctx.drive ? s : withholdDriveText(s))
  const wall = (d: Date) => epochToWall(d.getTime(), ctx.tz)

  const items = page.map((e): InboxItemDto => {
    const r = e.row
    const v = e.virtual
    const startAt = r?.startAt ?? v!.startAt
    const endAt = r?.endAt ?? v!.endAt
    const dueAt = r?.dueAt ?? v!.dueAt
    const state = r ? stateOf(r, ctx.now) : ctx.now.getTime() > dueAt.getTime() ? "missing" : "draft"
    const c = r ? countOf.get(r.id) : undefined
    const teamId = r?.teamId ?? v!.teamId
    // real minutes between INSTANTS (never wall-clock differences, which are wrong across a clock change): past due = first submission (or now, while there is none) minus the due time; open = the same
    // end point minus the end of the shift
    const filedAt = (r?.firstSubmittedAt ?? (r && r.status !== "draft" ? r.submittedAt : null))?.getTime() ?? ctx.now.getTime()
    return {
      id: r?.id ?? null, key: `${e.key.userId}:${e.key.patternId}:${e.key.date}`, userId: e.key.userId, person: nameOf(e.key.userId), patternId: e.key.patternId, teamId,
      shiftName: free(r?.shiftName ?? v!.shiftName), team: free(teamName.get(teamId) ?? ""), date: e.key.date,
      start: wall(startAt), end: wall(endAt), due: wall(dueAt), startAt: startAt.toISOString(), endAt: endAt.toISOString(), dueAt: dueAt.toISOString(),
      minutesLate: minutes(filedAt - dueAt.getTime()), minutesOpen: minutes(filedAt - endAt.getTime()),
      status: (r?.status ?? "draft") as InboxItemDto["status"], state, version: r?.version ?? 0, submissions: r?.submissions ?? 0,
      itemCount: c?.n ?? 0, doneCount: c?.done ?? 0, submittedAt: r?.submittedAt?.toISOString() ?? null, reviewedAt: r?.reviewedAt?.toISOString() ?? null, reviewedBy: r?.reviewedBy ? nameOf(r.reviewedBy) : null,
    }
  })
  return { items, nextCursor: more && last ? encodeInboxCursor(last.key) : null, counts: await inboxCounts(tx, ctx, f) }
}
