import { and, eq } from "drizzle-orm"
import type { Context, MiddlewareHandler } from "hono"
import { hasModule } from "@opsdesk/domain/entitlements"
import { can, type Access, type Module } from "@opsdesk/domain/permissions"
import type { AppEnv, ResolvedRole } from "../context"
import { roles } from "../../db/schema"
import { withTenant } from "../../db/tenant-tx"
import { entitlementsFor } from "../../modules/entitlements/service"
import { Forbidden } from "../errors"
import { SUPPORT_ROLE_ID, supportRole } from "./support"

/** Loads the caller's role ONCE per request and caches it in c.var.role. Fails closed: no tenant context or role is 403. */
export async function loadRole(c: Context<AppEnv>): Promise<ResolvedRole> {
  const cached = c.get("role")
  if (cached) return cached
  const tenant = c.get("tenant")
  const member = c.get("member")
  if (!tenant || !member) throw Forbidden("forbidden")
  // Support-grant path (T3.5): the synthetic read-only role, never a database row. Keyed on the grant context AND the
  // sentinel id (not on the role key, which a tenant may also use for a real custom role).
  if (c.get("support") || member.roleId === SUPPORT_ROLE_ID) {
    if (!c.get("support") || member.roleId !== SUPPORT_ROLE_ID) throw Forbidden("forbidden") // inconsistent context: fail closed
    const role = supportRole()
    c.set("role", role)
    return role
  }
  const [row] = await withTenant(c.get("deps").db, tenant.id, (tx) =>
    tx.select().from(roles).where(and(eq(roles.id, member.roleId), eq(roles.tenantId, tenant.id))),
  )
  if (!row) throw Forbidden("forbidden")
  const role = {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    home: row.home === "staff" ? "staff" : "manager",
    access: row.access as Record<Module, Access>,
    fieldRules: row.fieldRules,
  } satisfies ResolvedRole
  c.set("role", role)
  return role
}

/**
 * Guards a route by module access (after requireTenant). The role comes from loadRole, so stacking guards costs no
 * extra queries.
 */
export function requirePermission(module: Module, need: "read" | "write"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const role = await loadRole(c)
    if (!can(role, module, need)) throw Forbidden("forbidden")
    await next()
  }
}

/**
 * The modules the caller may read: the single place that decides what a cross-module feature (global search) may
 * surface. Data-driven from the role's own access map (no hard-coded module list).
 * Modules the tenant's plan (plus overrides) does not entitle are dropped too (FR-M0-15).
 */
export async function visibleModules(c: Context<AppEnv>): Promise<Module[]> {
  const role = await loadRole(c)
  const ent = await entitlementsFor(c.get("deps"), c.get("tenant")!.id) // loadRole already proved a tenant is present
  return (Object.keys(role.access) as Module[]).filter((m) => can(role, m, "read") && hasModule(ent, m))
}
