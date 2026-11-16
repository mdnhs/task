import { and, eq } from "drizzle-orm"
import type { MiddlewareHandler } from "hono"
import { can, type Access, type Module } from "@opsdesk/domain/permissions"
import type { AppEnv, ResolvedRole } from "../context"
import { roles } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { Forbidden } from "../errors"

/**
 * Guards a route by module access (after requireTenant). The member's role is loaded ONCE per request and cached in
 * c.var.role, so stacking guards costs no extra queries. Fails closed: no tenant context or a missing role is 403.
 */
export function requirePermission(module: Module, need: "read" | "write"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let role = c.get("role")
    if (!role) {
      const tenant = c.get("tenant")
      const member = c.get("member")
      if (!tenant || !member) throw Forbidden("forbidden")
      const [row] = await withTenant(c.get("deps").db, tenant.id, (tx) =>
        tx.select().from(roles).where(and(eq(roles.id, member.roleId), eq(roles.tenantId, tenant.id))),
      )
      if (!row) throw Forbidden("forbidden")
      role = {
        id: row.id,
        key: row.key,
        label: row.label,
        description: row.description,
        home: row.home === "staff" ? "staff" : "manager",
        access: row.access as Record<Module, Access>,
        fieldRules: row.fieldRules,
      } satisfies ResolvedRole
      c.set("role", role)
    }
    if (!can(role, module, need)) throw Forbidden("forbidden")
    await next()
  }
}
