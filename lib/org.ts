import "server-only"
import { cache } from "react"

import { apiServer } from "./api/server"
import { getData } from "./data"
import { loadOrg, type Org } from "./org-core"

export type { Org } from "./org-core"
export { neutralOrg } from "./org-core"

/** The signed-in company's zone, currency, locale, report deadline, departments and "today" (B6 T6.4). One read per request. Needs a session whose second factor is in order. */
export const getOrg = cache(async (): Promise<Org> => loadOrg(await apiServer()))

/**
 * MOCK: no backend until the owning task (T6.5 to T6.8) switches the page. The static seed company (public/data/shell/org.json, a frozen 2026-10-20 clock)
 * that pages still running on mock data use, together with their mock records, so the two stay consistent. Loading skeletons use it too (they never call the API).
 * A page that serves real tenant data uses getOrg().
 */
export async function getMockOrg(): Promise<Org> {
  return getData<Org>("shell/org.json")
}
