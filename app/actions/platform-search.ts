"use server"

import { buildPlatformIndex, getOperator, getPlatformNav, loadTenantList, platformQuickActions, type PlatformQuickAction, type PlatformSearchItem } from "@/features/platform"
import { apiServer } from "@/lib/api/server"
import { getPlatformSession } from "@/lib/session"

/**
 * The platform console's ⌘K index (D1), loaded lazily on the first open like the tenant index, so it is never in a page payload. Only for active staff whose second factor is in order
 * (the console gate: session.mfa), and filtered on the server by the operator's staff role (D3): the console pages, the tenants the API lists (name, slug, id: one page of 100) and the
 * "Request support access for …" actions.
 */
export async function platformSearchIndex(): Promise<{ items: PlatformSearchItem[]; config: { popular: string[]; actions: PlatformQuickAction[] } }> {
  const empty = { items: [], config: { popular: [], actions: [] } }
  const session = await getPlatformSession()
  if (!session.signedIn || !session.platformRole || session.mfa !== "ok") return empty
  const op = await getOperator()
  if (!op) return empty
  const [nav, list] = await Promise.all([getPlatformNav(), loadTenantList(await apiServer())])
  const items = buildPlatformIndex({ pages: nav.menu, tenants: list.rows }, op)
  return { items, config: { popular: [], actions: platformQuickActions(op) } }
}
