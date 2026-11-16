import { and, eq, min } from "drizzle-orm"
import type { Db } from "../db/client"
import { memberships, tenants } from "../db/schema"
import { withUser } from "../db/tenant-tx"

// NFR-04 default; a tenant's own value takes precedence.
export const DEFAULT_SESSION_IDLE_HOURS = 12

/**
 * Idle hours for a session that is not scoped to one tenant (/api/auth/*, /v1/me, accepting an invite):
 * the STRICTEST session_idle_hours across the user's active memberships, 12 when they have none.
 */
export async function strictestIdleHours(db: Db, userId: string): Promise<number> {
  const [row] = await withUser(db, userId, (tx) =>
    tx
      .select({ hours: min(tenants.sessionIdleHours) })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active"))),
  )
  return row?.hours ?? DEFAULT_SESSION_IDLE_HOURS
}
