import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm"
import { addDays, occurrenceInstants, weekdayOf, type ShiftPattern, type Weekday } from "@opsdesk/domain/shifts"
import { memberships, shiftAssignments, shiftPatterns } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"

export type PatternRow = typeof shiftPatterns.$inferSelect
export type AssignmentRow = typeof shiftAssignments.$inferSelect

/** One concrete shift of one member (F2: `shiftDate` is the date it STARTS on in the pattern's own zone; F3: instants, never wall strings). */
export type Occurrence = { userId: string; patternId: string; teamId: string; name: string; shiftDate: string; startAt: Date; endAt: Date; minutes: number }

const DAY_MS = 86_400_000
const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY_MS)

/** The domain pattern of a row (the team name is irrelevant to the engine; the team id travels in the row). */
export const domainPattern = (p: PatternRow): ShiftPattern => ({ id: p.id, name: p.name, team: p.teamId, start: p.startTime, end: p.endTime, days: p.days as Weekday[], ...(p.timeZone ? { timeZone: p.timeZone } : {}) })

/** The zone a pattern's dates and wall times are read in: its own, else the tenant's. */
export const patternZone = (p: Pick<PatternRow, "timeZone">, tenantTz: string): string => p.timeZone || tenantTz

/** Live (not archived) patterns of the tenant, by team. Exported so the EXPLAIN test plans the exact statement (shift_patterns_team_idx). */
export function livePatternsQuery(tx: TenantTx, tenantId: string) {
  return tx.select().from(shiftPatterns).where(and(eq(shiftPatterns.tenantId, tenantId), isNull(shiftPatterns.archivedAt))).orderBy(asc(shiftPatterns.teamId), asc(shiftPatterns.id))
}

/**
 * Assignments of the given patterns that cover any shift start date in [from, to] (inclusive; an open-ended one has no until_date), optionally
 * for some members only. Exported for the EXPLAIN test: with `userIds` the plan uses shift_assignments_user_idx, without it
 * shift_assignments_pattern_idx.
 */
export function assignmentsInWindowQuery(tx: TenantTx, tenantId: string, from: string, to: string, o: { patternIds: string[]; userIds?: string[] }) {
  return tx
    .select({ a: shiftAssignments })
    .from(shiftAssignments)
    .innerJoin(memberships, and(eq(memberships.tenantId, shiftAssignments.tenantId), eq(memberships.userId, shiftAssignments.userId), eq(memberships.status, "active")))
    .where(
      and(
        eq(shiftAssignments.tenantId, tenantId),
        inArray(shiftAssignments.patternId, o.patternIds),
        o.userIds ? inArray(shiftAssignments.userId, o.userIds) : undefined,
        lte(shiftAssignments.fromDate, to),
        or(isNull(shiftAssignments.untilDate), gte(shiftAssignments.untilDate, from)),
      ),
    )
    .orderBy(asc(shiftAssignments.fromDate), asc(shiftAssignments.id))
}

/**
 * The shift START dates in (after, upTo] on which `pattern` runs for a member holding `assignments` of it (pure; from/until inclusive; `until` is
 * the rule's own end date). Used by the occurrence engine's callers and by the `per_shift` recurrence job.
 */
export function shiftDatesBetween(pattern: Pick<PatternRow, "days">, assignments: Pick<AssignmentRow, "fromDate" | "untilDate">[], after: string, upTo: string, until?: string): string[] {
  const end = Math.min(dayNum(upTo), until ? dayNum(until) : Infinity)
  const out: string[] = []
  for (let n = dayNum(after) + 1; n <= end && out.length < 1000; n++) {
    const d = new Date(n * DAY_MS).toISOString().slice(0, 10)
    if (!(pattern.days as number[]).includes(weekdayOf(d))) continue
    if (assignments.some((a) => a.fromDate <= d && (!a.untilDate || d <= a.untilDate))) out.push(d)
  }
  return out
}

/**
 * Every shift that STARTS (in its pattern's zone) on a date in [from, to], for the members assigned to a live pattern on that date: each live pattern
 * whose `days` contain the pattern-local weekday of the date and each active member's assignment covering it, as UTC instants (domain
 * `occurrenceInstants`: the repeated hour takes the earlier instant, a gap time moves forward). An archived pattern produces nothing (F14). Sorted by
 * start instant, then member, then pattern. Pass at most a month at a time (the caller bounds the range).
 */
export async function occurrencesBetween(tx: TenantTx, tenantId: string, tz: string, from: string, to: string, o: { userIds?: string[] } = {}): Promise<Occurrence[]> {
  if (from > to || (o.userIds && o.userIds.length === 0)) return []
  const patterns = await livePatternsQuery(tx, tenantId)
  if (patterns.length === 0) return []
  const byId = new Map(patterns.map((p) => [p.id, p]))
  const rows = await assignmentsInWindowQuery(tx, tenantId, from, to, { patternIds: patterns.map((p) => p.id), userIds: o.userIds })
  const seen = new Set<string>()
  const out: Occurrence[] = []
  for (const { a } of rows) {
    const p = byId.get(a.patternId)!
    const dp = domainPattern(p)
    const last = a.untilDate && a.untilDate < to ? a.untilDate : to
    for (let d = a.fromDate > from ? a.fromDate : from; d <= last; d = addDays(d, 1)) {
      if (!p.days.includes(weekdayOf(d))) continue
      const key = `${a.userId}|${p.id}|${d}`
      if (seen.has(key)) continue
      seen.add(key)
      const i = occurrenceInstants(dp, d, tz)
      out.push({ userId: a.userId, patternId: p.id, teamId: p.teamId, name: p.name, shiftDate: d, startAt: new Date(i.startAt), endAt: new Date(i.endAt), minutes: i.minutes })
    }
  }
  return out.sort((x, y) => x.startAt.getTime() - y.startAt.getTime() || x.userId.localeCompare(y.userId) || x.patternId.localeCompare(y.patternId))
}
