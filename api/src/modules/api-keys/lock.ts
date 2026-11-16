import { and, eq } from "drizzle-orm"
import { can, type Module } from "@opsdesk/domain/permissions"
import type { ResolvedRole } from "../../core/context"
import { Forbidden } from "../../core/errors"
import { apiKeyRole } from "../../core/middleware/principal"
import { apiKeys, memberships, roles, user } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { effectiveAccess } from "./key"

/**
 * R25 for the API-key principal: the mutation-time re-check of lockActor (rbac/service.ts) when the actor is `apikey:<id>`.
 * Inside the mutation tx it re-reads the KEY (not revoked) and its creator's membership + role with FOR SHARE (an active member,
 * not erased), recomputes scopes ∩ the creator's current role, and re-checks the permission. So a revocation, a removal or a
 * demotion that commits first is seen, or has to wait for us, exactly as for a human actor. Any failure is 403 forbidden.
 */
export async function lockApiKeyActor(tx: TenantTx, tenantId: string, keyId: string, module: Module, need: "read" | "write"): Promise<ResolvedRole> {
  const [key] = await tx.select().from(apiKeys).where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenantId, tenantId))).for("share")
  if (!key || key.revokedAt !== null) throw Forbidden("forbidden")
  const [row] = await tx
    .select({ role: roles, status: memberships.status, erasedAt: user.erasedAt })
    .from(memberships)
    .innerJoin(roles, eq(roles.id, memberships.roleId))
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, key.createdBy)))
    .for("share", { of: [memberships, roles] })
  if (!row || row.status !== "active" || row.erasedAt !== null) throw Forbidden("forbidden")
  const role = apiKeyRole({ access: effectiveAccess(key.scopes, row.role.access as Record<string, string>) })
  if (!can(role, module, need)) throw Forbidden("forbidden")
  return role
}
