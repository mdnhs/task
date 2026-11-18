import { withholdDriveText } from "@opsdesk/domain/devices"
import type { Deps } from "../../deps"
import type { TenantTx } from "../../db/tenant-tx"
import { notify, type Enqueue } from "../notifications"
import type { TaskCtx, TaskRow } from "./scope"

export type TaskEnv = { deps: Deps; enqueue: Enqueue }

/** Who hears about a change to a task: its assignees and its creator, never the person who made the change (FR-M1-12). */
export const changeRecipients = (ctx: Pick<TaskCtx, "me" | "actorId">, task: Pick<TaskRow, "creatorId">, assignees: string[], extra: string[] = []): string[] =>
  [...new Set([...assignees, ...(task.creatorId ? [task.creatorId] : []), ...extra])].filter((u) => u !== ctx.me && u !== ctx.actorId).sort()

/**
 * In-app (and push, per preference) notice of kind "task" to each recipient, written in the request tx (ruling D15). The body is the
 * ref and title only (a Drive link in the title is withheld at write time, ruling E13): no person's name, so an erasure never leaves a name in someone's inbox.
 */
export async function notifyTask(tx: TenantTx, env: TaskEnv, ctx: Pick<TaskCtx, "tenantId">, task: Pick<TaskRow, "refNo" | "title">, recipients: string[], title: string, link?: string): Promise<void> {
  for (const userId of recipients) {
    await notify(tx, ctx.tenantId, { userId, kind: "task", title, body: `TSK-${task.refNo} ${withholdDriveText(task.title)}`, link: link ?? `/tasks/TSK-${task.refNo}` }, env.deps, env.enqueue)
  }
}
