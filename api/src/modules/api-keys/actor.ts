import type { Context } from "hono"
import type { AppEnv } from "../../core/context"
import { loadRole } from "../../core/middleware/permission"

/** The caller's current role access map (the same loadRole every guard uses, so stacking costs no extra query). */
export async function loadRoleAccess(c: Context<AppEnv>): Promise<Record<string, string>> {
  return (await loadRole(c)).access
}
