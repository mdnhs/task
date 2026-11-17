import { and, eq } from "drizzle-orm"
import type { Db } from "../../db/client"
import { memberships, platformStaff, roles, tenants, user } from "../../db/schema"
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

/** The caller as `GET /v1/me` shows it: the profile fields the shell needs, and the platform staff role (null unless an ACTIVE staff row exists). */
export async function loadMe(db: Db, userId: string): Promise<{ name: string; emailVerified: boolean; twoFactorEnabled: boolean; platformRole: "owner" | "support" | "billing" | "viewer" | null }> {
  const [u] = await db.select({ name: user.name, emailVerified: user.emailVerified, twoFactorEnabled: user.twoFactorEnabled }).from(user).where(eq(user.id, userId))
  const [staff] = await db.select({ role: platformStaff.role, status: platformStaff.status }).from(platformStaff).where(eq(platformStaff.userId, userId))
  return {
    name: u?.name ?? "",
    emailVerified: u?.emailVerified === true,
    twoFactorEnabled: u?.twoFactorEnabled === true,
    platformRole: staff && staff.status === "active" ? (staff.role as "owner" | "support" | "billing" | "viewer") : null,
  }
}

/** The tenant's display name (`tenants` has no RLS; the request context carries no name). */
export async function tenantDisplayName(db: Db, tenantId: string): Promise<string> {
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId))
  return t?.name ?? ""
}
