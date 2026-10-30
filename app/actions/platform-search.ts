"use server"

import { buildPlatformIndex, getOperator, getPlatformNav, getPlatformSeed, getStaff, platformQuickActions, type PlatformQuickAction, type PlatformSearchItem } from "@/features/platform"
import { getSession } from "@/lib/session"

/**
 * The platform console's ⌘K index (D1), loaded lazily on the first open like the tenant index, so it is never in a
 * page payload. Only for the platform role, and filtered on the server by the operator's staff role (D3): pages,
 * tenants, invoices (billing.read), support and data requests, staff, and the "Request support access for …" actions.
 */
export async function platformSearchIndex(): Promise<{ items: PlatformSearchItem[]; config: { popular: string[]; actions: PlatformQuickAction[] } }> {
  const empty = { items: [], config: { popular: [], actions: [] } }
  const session = await getSession()
  if (!session.signedIn || !session.role.platform) return empty
  const [op, nav, seed, { staff }] = await Promise.all([getOperator(), getPlatformNav(), getPlatformSeed(), getStaff()])
  const items = buildPlatformIndex(
    { pages: nav.menu, tenants: seed.tenants, requests: seed.requests, staff, invoices: seed.invoices, dataRequests: seed.dataRequests },
    op,
  )
  return { items, config: { popular: [], actions: platformQuickActions(op) } }
}
