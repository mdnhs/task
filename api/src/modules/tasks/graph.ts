import { sql } from "drizzle-orm"
import type { TenantTx } from "../../db/tenant-tx"

/** Two-key advisory lock namespace for edits of a tenant's task dependency graph ("tgrp"), same pattern as RBAC_LOCK_NS / TEAM_LOCK_NS. */
export const TASK_GRAPH_LOCK_NS = 0x74677270

/**
 * One writer per tenant on the dependency graph, taken FIRST in a mutation (before lockActor and any row lock) and released at commit or
 * rollback. It is what stops two edits that only form a cycle TOGETHER from both passing the cycle check (Review Focus #2), and it makes a
 * knock-on reschedule read a graph nobody can change under it.
 */
export const lockTaskGraph = (tx: TenantTx, tenantId: string) => tx.execute(sql`select pg_advisory_xact_lock(${TASK_GRAPH_LOCK_NS}::int, hashtext(${tenantId}::text))`)
