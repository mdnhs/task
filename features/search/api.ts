import { getData } from "@/lib/data"
import { ME_ID } from "@/lib/people"
import type { Module, Role } from "@/lib/types"

import { buildIndex, filterActionsForRole, filterIndexForRole, filterPopularForRole, type RawSources } from "./build"
import type { QuickAction, SearchConfig, SearchItem } from "./types"

// Reads the JSON files directly (not other features' api.ts) so features stay independent.
async function getSources(): Promise<RawSources> {
  const [people, tasks, reports, issues, payroll, orders, staff, candidates, clients, documents] = await Promise.all([
    getData<{ people: RawSources["people"] }>("tasks/people.json"),
    getData<{ tasks: RawSources["tasks"] }>("tasks/tasks.json"),
    getData<{ reports: RawSources["reports"] }>("reports/reports.json"),
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
    tasks: tasks.tasks,
    reports: reports.reports,
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
