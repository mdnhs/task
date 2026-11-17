import { publish } from "../../core/events"
import type { TenantTx } from "../../db/tenant-tx"
import type { TaskStatus } from "@opsdesk/domain/task-model"
import type { TaskCtx } from "./scope"

/**
 * Task domain events (ruling D14): ids only, never a title, description or name. They are NOT in the webhook projection allow-list
 * yet. Call these LAST in a mutation (publish takes the relay-hint lock, see core/events/bus.ts).
 */
export type TaskEvent =
  | { type: "task.created"; payload: { taskId: string; parentId: string | null; projectId: string | null; seriesId: string | null } }
  | { type: "task.updated"; payload: { taskId: string; historyId: string; fields: string[] } }
  | { type: "task.assigned"; payload: { taskId: string; added: string[]; removed: string[] } }
  | { type: "task.status_changed"; payload: { taskId: string; from: TaskStatus; to: TaskStatus } }
  | { type: "task.completed"; payload: { taskId: string } }
  | { type: "task.submitted"; payload: { taskId: string; round: number } }
  | { type: "task.comment_added"; payload: { taskId: string; commentId: string } }
  | { type: "task.archived" | "task.restored" | "task.purged"; payload: { taskId: string } }
  | { type: "project.created" | "project.updated" | "project.deleted"; payload: { projectId: string } }

export async function publishTaskEvent(tx: TenantTx, ctx: Pick<TaskCtx, "tenantId" | "actorId" | "now">, e: TaskEvent): Promise<void> {
  await publish(tx, { tenantId: ctx.tenantId, type: e.type, payload: e.payload, actorId: ctx.actorId }, ctx.now)
}
