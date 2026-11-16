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
