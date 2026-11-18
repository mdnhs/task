import { and, eq, inArray, notExists, sql } from "drizzle-orm"
import { locationSupervisors, memberships, roles, rosterOfficeLimits } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { notifyMany } from "../notifications"
import type { RosterCtx } from "./scope"
import type { RosterEnv } from "./write"

// What a published week and an office edit tell the rest of the system (B8 Task 10). Event payloads are ids only (F19); notifications carry only generic text:
// no name, no time and no site of anyone else, so a person at a site the reader cannot see is never described (the person is told about THEIR OWN shifts only).

/** R8-14: what B9 (and a later reports plan) consumes when a week is published. */
export const weekPublishedPayload = (w: { id: string; locationId: string; weekStart: string }, shiftIds: string[]) => ({ weekId: w.id, locationId: w.locationId, weekStart: w.weekStart, shiftIds })

/** An office edit of a published week: ids only. */
export const shiftChangedPayload = (w: { id: string; locationId: string; weekStart: string }, a: { action: "added" | "moved" | "removed"; shiftIds: string[]; userIds: string[] }) => ({
  weekId: w.id, locationId: w.locationId, weekStart: w.weekStart, action: a.action, shiftIds: a.shiftIds, userIds: a.userIds,
})

const NOTICE = {
  published: { title: "Roster published", body: (weekStart: string) => `Your shifts for the week starting ${weekStart} are published. Please confirm them.` },
  changed: { title: "Shift changed", body: (weekStart: string) => `Your roster for the week starting ${weekStart} was changed. Please check it and confirm again.` },
} as const

/**
 * One notification per ACTIVE person (R8-17): however many shifts a person has in the week or in the mutation, they hear once; a deactivated member (whose shift stays, flagged `left`) hears
 * nothing on any channel; an open shift (null) notifies nobody. Goes through the shared notify engine in one batch (O(1) lookups), so in-app, email and push follow each person's
 * own preferences and quiet hours. Returns the people actually told.
 */
export async function notifyRostered(tx: TenantTx, ctx: Pick<RosterCtx, "tenantId">, env: RosterEnv, userIds: (string | null)[], kind: keyof typeof NOTICE, weekStart: string): Promise<string[]> {
  const wanted = [...new Set(userIds.filter((u): u is string => u !== null))].sort()
  if (wanted.length === 0) return []
  const active = new Set((await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active"), inArray(memberships.userId, wanted)))).map((m) => m.userId))
  const people = wanted.filter((u) => active.has(u))
  await notifyMany(tx, ctx.tenantId, people.map((userId) => ({ userId, kind: "member" as const, title: NOTICE[kind].title, body: NOTICE[kind].body(weekStart), link: "/rosters" })), env.deps, env.enqueue)
  return people
}

/** One notice to one person (generic text; a person is named only through the `{{subject}}` token, rendered when it is read). */
export type Notice = { userId: string; title: string; body: string; subjectUserId?: string }

/**
 * Tells ACTIVE people only (a deactivated member hears nothing on any channel), one notice per person and title, in one batch: the lookups are O(1) however many people (`notifyMany`),
 * never per recipient under the tenant lock.
 */
export async function notifyActive(tx: TenantTx, ctx: Pick<RosterCtx, "tenantId">, env: RosterEnv, notices: Notice[]): Promise<void> {
  const wanted = [...new Set(notices.map((n) => n.userId))].sort()
  if (wanted.length === 0) return
  const active = new Set((await tx.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, ctx.tenantId), eq(memberships.status, "active"), inArray(memberships.userId, wanted)))).map((m) => m.userId))
  const seen = new Set<string>()
  const send = notices.filter((n) => {
    const k = `${n.userId}|${n.title}`
    if (!active.has(n.userId) || seen.has(k)) return false
    seen.add(k)
    return true
  })
  await notifyMany(tx, ctx.tenantId, send.map((n) => ({ userId: n.userId, kind: "member" as const, title: n.title, body: n.body, link: "/rosters", ...(n.subjectUserId ? { subjectUserId: n.subjectUserId } : {}) })), env.deps, env.enqueue)
}

/**
 * Who decides or is asked about a site's roster: the active office roles that cover it (a Roster Manager excepted from the site is not asked) and, when `supervisors` is set, the active supervisors
 * granted the site. Never anybody in `exclude` (the requester, the people the request is about). Two queries however many people.
 */
export async function approversOf(tx: TenantTx, tenantId: string, locationId: string, o: { supervisors: boolean; exclude: string[] }): Promise<string[]> {
  const base = [eq(memberships.tenantId, tenantId), eq(memberships.status, "active"), eq(roles.tenantId, tenantId), sql`${roles.access}->>'roster' = 'write'`]
  const office = await tx
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .where(and(eq(roles.rosterLevel, "office"), ...base, notExists(tx.select({ one: sql`1` }).from(rosterOfficeLimits).where(and(eq(rosterOfficeLimits.tenantId, tenantId), eq(rosterOfficeLimits.userId, memberships.userId), eq(rosterOfficeLimits.locationId, locationId))))))
  const sup = o.supervisors
    ? await tx
        .select({ userId: memberships.userId })
        .from(locationSupervisors)
        .innerJoin(memberships, and(eq(memberships.tenantId, locationSupervisors.tenantId), eq(memberships.userId, locationSupervisors.userId)))
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(locationSupervisors.tenantId, tenantId), eq(locationSupervisors.locationId, locationId), eq(roles.rosterLevel, "supervisor"), ...base))
    : []
  const skip = new Set(o.exclude)
  return [...new Set([...office, ...sup].map((r) => r.userId))].filter((u) => !skip.has(u)).sort()
}
