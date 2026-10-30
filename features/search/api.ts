import { getData } from "@/lib/data"
import { getOrg } from "@/lib/org"
import { ME_ID, getPeople } from "@/lib/people"
import { reportScope } from "@/lib/permissions"
import { reportState, scopeReports } from "@/lib/shift-report"
import { getShiftReportData } from "@/lib/shift-reports-data"
import type { Module, Role } from "@/lib/types"

import { buildIndex, filterActionsForRole, filterIndexForRole, filterPopularForRole, type RawSources } from "./build"
import type { QuickAction, SearchConfig, SearchItem } from "./types"

// Reads the JSON files directly (not other features' api.ts) so features stay independent.
// Shift reports (FR-M1-28) come from the shared report model, cut to what the role may see (own / team / all).
async function getShiftReports(role: Role): Promise<RawSources["reports"]> {
  const org = await getOrg()
  const [{ rows, shifts }, people] = await Promise.all([getShiftReportData(org), getPeople()])
  const scope = reportScope(role, ME_ID)
  if (!scope) return []
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? id
  return scopeReports(rows, scope, shifts.members).map((r) => ({
    id: r.id, date: r.date, dept: r.team, owner: r.personId, status: reportState(r, org.today, org.timezone),
    title: `Shift report: ${name(r.personId)}, ${r.shiftName}, ${r.date}`,
  }))
}

async function getSources(role: Role): Promise<RawSources> {
  const [people, tasks, reports, issues, payroll, orders, staff, candidates, clients, documents] = await Promise.all([
    getData<{ people: RawSources["people"] }>("tasks/people.json"),
    getData<{ tasks: RawSources["tasks"] }>("tasks/tasks.json"),
    getShiftReports(role),
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
    reports,
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
    getSources(role),
    getData<{ popular: { term: string; module: Module }[] }>("search/popular.json"),
    getData<{ actions: QuickAction[] }>("search/actions.json"),
  ])
  const me = src.people.find((p) => p.id === ME_ID) ?? { name: "" }
  return {
    items: filterIndexForRole(buildIndex(src), role, me),
    config: { popular: filterPopularForRole(popular.popular, role), actions: filterActionsForRole(actions.actions, role) },
  }
}
