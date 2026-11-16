import { sql } from "drizzle-orm"
import type { Db } from "./client"

export type TenantTx = Parameters<Parameters<Db["transaction"]>[0]>[0]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Runs fn in a transaction scoped to one tenant. The setting is transaction-local
 * (set_config(..., true)), so it can never leak to the next pooled query.
 */
export function withTenant<T>(db: Db, tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  if (!UUID.test(tenantId)) return Promise.reject(new Error("Invalid tenant id"))
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`)
    return fn(tx)
  })
}

/**
 * Runs fn in a transaction where `app.user_id` is the authenticated user. This only unlocks the
 * narrow "read my own memberships (and the roles they point at)" policies; it grants no tenant data.
 */
export function withUser<T>(db: Db, userId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`)
    return fn(tx)
  })
}
