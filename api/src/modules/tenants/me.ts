import { and, eq } from "drizzle-orm"
import type { Db } from "../../db/client"
import { memberships, roles, tenants } from "../../db/schema"
import { withUser } from "../../db/tenant-tx"

/** The caller's active tenants (via the own-membership RLS policies). */
export function listUserTenants(db: Db, userId: string): Promise<{ slug: string; name: string; roleKey: string }[]> {
  return withUser(db, userId, (tx) =>
    tx
      .select({ slug: tenants.slug, name: tenants.name, roleKey: roles.key })
      .from(memberships)
      .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
      .innerJoin(roles, eq(roles.id, memberships.roleId))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(tenants.slug),
  )
}
