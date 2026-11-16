import { and, eq, ne } from "drizzle-orm"
import { subscribe } from "../../core/events"
import { registerJob } from "../../core/queue/queue"
import { memberships, roles } from "../../db/schema"
import { notify, SEND_JOB, SWEEP_JOB, sendNotification, sweepNotifications, SUBJECT_TOKEN } from "./service"

/**
 * Registers the `notification.send` job handler and the event subscribers. Call once per process (worker.ts, tests);
 * safe to call again (the job map overwrites, a duplicate subscriber name is ignored).
 */
export function registerNotifications(): void {
  registerJob(SEND_JOB, sendNotification)
  registerJob(SWEEP_JOB, sweepNotifications)
  try {
    // member.joined -> every active owner of the tenant (except the joiner) gets a "member" notification.
    subscribe("member.joined", "notifications.member-joined", async (e, { tx, deps, enqueue }) => {
      const joiner = typeof e.payload.userId === "string" ? e.payload.userId : e.actorId
      const owners = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.tenantId, e.tenantId), eq(roles.key, "owner"), eq(memberships.status, "active"), ...(joiner ? [ne(memberships.userId, joiner)] : [])))
      if (!joiner) return
      // The person may have left or been erased between the event and its relay: then there is nobody to announce.
      const [still] = await tx.select({ u: memberships.userId }).from(memberships).where(and(eq(memberships.tenantId, e.tenantId), eq(memberships.userId, joiner)))
      if (!still) return
      for (const o of owners) {
        // The name is not stored: the body carries {{subject}}, rendered when the notice is read or sent.
        await notify(tx, e.tenantId, { userId: o.userId, kind: "member", title: "New member joined", body: `${SUBJECT_TOKEN} joined the team.`, subjectUserId: joiner }, deps, enqueue)
      }
    })
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("Duplicate event subscriber")) throw err
  }
}
