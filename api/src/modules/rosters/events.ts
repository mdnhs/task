import type { TenantTx } from "../../db/tenant-tx"
import { notify } from "../notifications"
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
 * One notification per person (R8-17): however many shifts a person has in the week or in the mutation, they hear once. An open shift (null) notifies nobody.
 * Goes through the shared notify engine, so in-app, email and push follow each person's own preferences and quiet hours.
 */
export async function notifyRostered(tx: TenantTx, ctx: Pick<RosterCtx, "tenantId">, env: RosterEnv, userIds: (string | null)[], kind: keyof typeof NOTICE, weekStart: string): Promise<string[]> {
  const people = [...new Set(userIds.filter((u): u is string => u !== null))].sort()
  for (const userId of people) await notify(tx, ctx.tenantId, { userId, kind: "member", title: NOTICE[kind].title, body: NOTICE[kind].body(weekStart), link: "/rosters" }, env.deps, env.enqueue)
  return people
}
