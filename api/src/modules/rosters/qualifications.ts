import { and, asc, eq } from "drizzle-orm"
import { epochToWall } from "@opsdesk/domain/shifts"
import { AppError } from "../../core/errors"
import { memberQualifications } from "../../db/schema"
import { qualificationKey } from "./locations"
import type { TenantTx } from "../../db/tenant-tx"
import type { QualificationsDto } from "./dto"
import { reachablePerson } from "./people"
import type { RosterCtx } from "./scope"
import { auditRoster, officeOnly } from "./write"

const unprocessable = (code: string) => new AppError(422, code, "Unprocessable Entity")
const MAX_QUALIFICATIONS = 50

/** The tenant's today (YYYY-MM-DD) on the injected clock: the day a qualification is judged expired on. */
export const todayOf = (ctx: Pick<RosterCtx, "now" | "tz">): string => epochToWall(ctx.now.getTime(), ctx.tz).slice(0, 10)

/** A qualification is valid THROUGH its expiry date: expired is true from the day after. No expiry date never expires. */
export const isExpired = (expiresOn: string | null, today: string): boolean => expiresOn !== null && expiresOn < today

export const realDate = (d: string): boolean => {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) : Number.NaN
  return Number.isFinite(ms) && epochToWall(ms, "UTC").slice(0, 10) === d
}

const view = (rows: { type: string; expiresOn: string | null }[], today: string) => rows.map((r) => ({ type: r.type, expiresOn: r.expiresOn, expired: isExpired(r.expiresOn, today) }))
const snap = (rows: { type: string; expiresOn: string | null }[]) => rows.map((r) => ({ type: r.type, expiresOn: r.expiresOn }))

/** The person's qualifications, ordered by type, each with `expired` computed on the clock. Read: the person, an office role, a supervisor of one of the person's locations (else the same 404 member_not_found). */
export async function getQualifications(tx: TenantTx, ctx: RosterCtx, userId: string): Promise<QualificationsDto> {
  await reachablePerson(tx, ctx, userId)
  const rows = await tx.select({ type: memberQualifications.type, expiresOn: memberQualifications.expiresOn }).from(memberQualifications).where(and(eq(memberQualifications.tenantId, ctx.tenantId), eq(memberQualifications.userId, userId))).orderBy(asc(memberQualifications.type))
  return { userId, items: view(rows, todayOf(ctx)) }
}

/**
 * PUT: the person's whole set (office only). Types are free-text keys (the same text a shift type's `requires` lists): trimmed, 1..80, unique, at most 50; an expiry
 * is a real calendar date or null. A type that stays keeps its row (and its proof file link for B11); a removed type is deleted. An unchanged set writes nothing.
 */
export async function setQualifications(tx: TenantTx, ctx: RosterCtx, userId: string, input: { type: string; expiresOn?: string | null }[]): Promise<QualificationsDto> {
  officeOnly(ctx)
  await reachablePerson(tx, ctx, userId, { lock: "share" })
  const next = new Map<string, string | null>()
  for (const q of input) {
    const type = qualificationKey(q.type)
    const exp = q.expiresOn ?? null
    if (type.length < 1 || type.length > 80 || /[\u0000-\u001f\u007f]/.test(type) || next.has(type) || (exp !== null && !realDate(exp))) throw unprocessable("invalid_qualification")
    next.set(type, exp)
  }
  if (next.size > MAX_QUALIFICATIONS) throw unprocessable("invalid_qualification")
  const old = await tx.select().from(memberQualifications).where(and(eq(memberQualifications.tenantId, ctx.tenantId), eq(memberQualifications.userId, userId))).orderBy(asc(memberQualifications.type)).for("update")
  const had = new Map(old.map((r) => [r.type, r]))
  const changed = [...next].filter(([t, e]) => had.has(t) && had.get(t)!.expiresOn !== e)
  const added = [...next].filter(([t]) => !had.has(t))
  const removed = old.filter((r) => !next.has(r.type))
  if (changed.length + added.length + removed.length > 0) {
    for (const r of removed) await tx.delete(memberQualifications).where(and(eq(memberQualifications.tenantId, ctx.tenantId), eq(memberQualifications.id, r.id)))
    for (const [type, expiresOn] of changed) await tx.update(memberQualifications).set({ expiresOn, updatedAt: ctx.now }).where(and(eq(memberQualifications.tenantId, ctx.tenantId), eq(memberQualifications.userId, userId), eq(memberQualifications.type, type)))
    if (added.length) await tx.insert(memberQualifications).values(added.map(([type, expiresOn]) => ({ tenantId: ctx.tenantId, userId, type, expiresOn, createdBy: ctx.actorId, createdAt: ctx.now, updatedAt: ctx.now })))
    await auditRoster(tx, ctx, {
      action: "roster.qualifications_changed", entity: "membership", entityId: userId, before: { qualifications: snap(old) },
      after: { qualifications: [...next].map(([type, expiresOn]) => ({ type, expiresOn })).sort((a, b) => a.type.localeCompare(b.type)) },
    })
  }
  const rows = [...next].map(([type, expiresOn]) => ({ type, expiresOn })).sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
  return { userId, items: view(rows, todayOf(ctx)) }
}
