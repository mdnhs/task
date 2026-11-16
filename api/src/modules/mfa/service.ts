import { eq } from "drizzle-orm"
import { parseMfaPolicy, type MfaPolicy } from "@opsdesk/domain/mfa"
import { AppError } from "../../core/errors"
import { roles, tenants } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { recordAudit } from "../audit"
import { lockActor } from "../rbac"

/**
 * Replaces the tenant's MFA policy. Actor permission is re-checked inside the tx (R25), role keys are validated
 * against this tenant's roles, and the change is audited with before/after in the same tx.
 */
export async function setMfaPolicy(tx: TenantTx, tenantId: string, actorId: string, input: unknown, now: Date): Promise<MfaPolicy> {
  await lockActor(tx, tenantId, actorId, "settings", "write")
  const valid = (await tx.select({ key: roles.key }).from(roles).where(eq(roles.tenantId, tenantId))).map((r) => r.key)
  const policy = parseMfaPolicy(input, valid)
  if (!policy) throw new AppError(422, "invalid_mfa_policy", "Unprocessable Entity")
  const [before] = await tx.select({ p: tenants.mfaPolicy }).from(tenants).where(eq(tenants.id, tenantId)).for("update")
  await tx.update(tenants).set({ mfaPolicy: policy }).where(eq(tenants.id, tenantId))
  await recordAudit(tx, tenantId, { action: "settings.mfa_policy.updated", entity: "tenant", entityId: tenantId, actorId, before: before?.p ?? null, after: policy }, now)
  return policy
}
