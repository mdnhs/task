import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { withTenant, type TenantTx } from "../../db/tenant-tx"
import { withTenantAfterCommit } from "../notifications"
import type { TaskEnv } from "./notify"
import { loadTaskCtx, type TaskCtx } from "./scope"

/** A read: one tenant tx, the caller's context from the request (role as loaded by the guard). */
export function read1<T>(c: Context<AppEnv>, fn: (tx: TenantTx, ctx: TaskCtx) => Promise<T>): Promise<T> {
  return withTenant(c.get("deps").db, c.get("tenant")!.id, async (tx) => fn(tx, await loadTaskCtx(c, tx)))
}

/** A mutation: the actor lock (R25) first, then the work; notification jobs are enqueued only after the tx commits. */
export function mutate<T>(c: Context<AppEnv>, fn: (tx: TenantTx, env: TaskEnv, ctx: TaskCtx) => Promise<T>): Promise<T> {
  const deps = c.get("deps")
  return withTenantAfterCommit(deps, c.get("tenant")!.id, async (tx, enqueue) => fn(tx, { deps, enqueue }, await loadTaskCtx(c, tx, "write")))
}

