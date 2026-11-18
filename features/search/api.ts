import { getData } from "@/lib/data"
import { isMockRoute, mockEnabled, MOCK_MODULES } from "@/lib/mock-registry"
import { ME_ID } from "@/lib/people"
import type { Module, Role } from "@/lib/types"

import { buildIndex, filterActionsForRole, filterIndexForRole, filterPopularForRole, type RawSources } from "./build"
import type { QuickAction, SearchConfig, SearchItem } from "./types"

// Reads the JSON files directly (not other features' api.ts) so features stay independent.
// Shift reports are the API's now (B6 T6.7): their search hits come from GET /v1/search as the user types (T6.8), so the mock index holds no reports.

async function getSources(): Promise<RawSources> {
  // Tasks are the API's now (B6 T6.6): their hits come from GET /v1/search as the user types, so the mock index holds none (T6.8 carry-in: tasks/tasks.json is deleted).
  const [people, issues, payroll, orders, staff, candidates, clients, documents] = await Promise.all([
    getData<{ people: RawSources["people"] }>("tasks/people.json"),
    getData<{ items: RawSources["issues"] }>("attention/items.json"),
    getData<{ issues: RawSources["payroll"] }>("payroll/issues.json"),
    getData<{ orders: RawSources["orders"] }>("orders/orders.json"),
    getData<{ staff: RawSources["staff"] }>("staff-rosters/staff.json"),
    getData<{ candidates: RawSources["candidates"] }>("recruitment/candidates.json"),
    getData<{ clients: RawSources["clients"] }>("files/client-files.json"),
    getData<{ documents: RawSources["documents"] }>("files/employee-docs.json"),
  ])
  return {
    people: people.people,
    tasks: [],
    reports: [],
    issues: issues.items,
    payroll: payroll.issues,
    orders: orders.orders,
    staff: staff.staff,
    candidates: candidates.candidates,
    clients: clients.clients,
    documents: documents.documents,
  }
}

/** The role-filtered index plus quick actions and popular searches. Call on the server only. */
export async function getSearchData(role: Role): Promise<{ items: SearchItem[]; config: SearchConfig }> {
  // MOCK: no backend until B8 to B11. The mock-backed kinds are indexed only on a demo deployment (ENABLE_MOCK_MODULES=1); data hits come from the API as the user types.
  if (!mockEnabled()) {
    const [popular, actions] = await Promise.all([
      getData<{ popular: { term: string; module: Module }[] }>("search/popular.json"),
      getData<{ actions: QuickAction[] }>("search/actions.json"),
    ])
    // The shortcuts and popular terms of the mock-only screens are not offered either: they would lead to the unavailable state.
    const realPopular = popular.popular.filter((p) => !MOCK_MODULES.includes(p.module))
    const realActions = actions.actions.filter((a) => !isMockRoute(a.href))
    return { items: [], config: { popular: filterPopularForRole(realPopular, role), actions: filterActionsForRole(realActions, role) } }
  }
  const [src, popular, actions] = await Promise.all([
    getSources(),
    getData<{ popular: { term: string; module: Module }[] }>("search/popular.json"),
    getData<{ actions: QuickAction[] }>("search/actions.json"),
  ])
  const me = src.people.find((p) => p.id === ME_ID) ?? { name: "" }
  return {
    items: filterIndexForRole(buildIndex(src), role, me),
    config: { popular: filterPopularForRole(popular.popular, role), actions: filterActionsForRole(actions.actions, role) },
  }
}
