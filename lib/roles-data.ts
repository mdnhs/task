// MOCK: no backend wiring until the settings task (T6.5, GET /v1/roles). The role LIST the settings pages offer (users panel, MFA rule) still comes from
// the seed file, because the session now holds only the caller's own role (B6 I8).
import { getData } from "./data"
import type { Role } from "./types"

/** Tenant roles from the seed (the console's platform role is never a tenant role). */
export async function getTenantRoles(): Promise<Role[]> {
  const { roles } = await getData<{ roles: Role[] }>("shell/roles.json")
  return roles.filter((r) => !r.platform)
}
