import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { withTenantAfterCommit } from "../notifications"
import type { TaskEnv } from "./notify"
import { lockTaskGraph } from "./graph"
import { loadTaskCtx, type TaskCtx } from "./scope"

/** A read: one tenant tx, the caller's context from the request (role as loaded by the guard). */
export function read1<T>(c: Context<AppEnv>, fn: (tx: TenantTx, ctx: TaskCtx) => Promise<T>): Promise<T> {
  return withTenant(c.get("deps").db, c.get("tenant")!.id, async (tx) => fn(tx, await loadTaskCtx(c, tx)))
}

/**
 * A mutation: the actor lock (R25) first, then the work; notification jobs are enqueued only after the tx commits. `graphLock` takes the
 * tenant's task-graph advisory lock BEFORE the actor lock (lock order: advisory → actor → task rows), for dependency edits and knock-on.
 */
export function mutate<T>(c: Context<AppEnv>, fn: (tx: TenantTx, env: TaskEnv, ctx: TaskCtx) => Promise<T>, o: { graphLock?: boolean } = {}): Promise<T> {
  const deps = c.get("deps")
  const tenantId = c.get("tenant")!.id
  return withTenantAfterCommit(deps, tenantId, async (tx, enqueue) => {
    if (o.graphLock) await lockTaskGraph(tx, tenantId)
    return fn(tx, { deps, enqueue }, await loadTaskCtx(c, tx, "write"))
  })
}

