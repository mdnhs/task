import { and, eq, ne } from "drizzle-orm"
import { subscribe } from "../../core/events"
import { registerJob } from "../../core/queue/queue"
import { memberships, roles, user } from "../../db/schema"
import { notify, SEND_JOB, sendNotification } from "./service"

/**
 * Registers the `notification.send` job handler and the event subscribers. Call once per process (worker.ts, tests);
 * safe to call again (the job map overwrites, a duplicate subscriber name is ignored).
 */
export function registerNotifications(): void {
  registerJob(SEND_JOB, sendNotification)
  try {
    // member.joined -> every active owner of the tenant (except the joiner) gets a "member" notification.
    subscribe("member.joined", "notifications.member-joined", async (e, { tx, deps, enqueue }) => {
      const joiner = typeof e.payload.userId === "string" ? e.payload.userId : e.actorId
      const owners = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(roles, eq(roles.id, memberships.roleId))
        .where(and(eq(memberships.tenantId, e.tenantId), eq(roles.key, "owner"), eq(memberships.status, "active"), ...(joiner ? [ne(memberships.userId, joiner)] : [])))
      const [who] = joiner ? await tx.select({ name: user.name }).from(user).where(eq(user.id, joiner)) : []
      for (const o of owners) {
        await notify(tx, e.tenantId, { userId: o.userId, kind: "member", title: "New member joined", body: who?.name ? `${who.name} joined the team.` : "A new member joined the team." }, deps, enqueue)
      }
    })
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith("Duplicate event subscriber")) throw err
  }
}
