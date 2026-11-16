import { roles } from "../../db/schema"
import type { TenantTx } from "../../db/tenant-tx"
import { roleTemplates } from "./defaults"

/** Seeds the role templates (R3) for a tenant, inside its transaction. Returns key -> role id. */
export async function seedRoleTemplates(tx: TenantTx, tenantId: string): Promise<Map<string, string>> {
  const rows = await tx
    .insert(roles)
    .values(
      roleTemplates().map((r) => ({
        tenantId,
        key: r.id,
        label: r.label,
        description: r.description ?? "",
        home: r.home,
        access: r.access,
        isTemplate: true,
      })),
    )
    .returning({ id: roles.id, key: roles.key })
  return new Map(rows.map((r) => [r.key, r.id]))
}
