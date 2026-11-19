// Server side of shift reports (B6 T6.7): every screen reads the API as the signed-in member. Scope is the SERVER's (F5, I14): the inbox holds what `GET /v1/shift-reports` returns for this
// caller (own, direct reports for a team manager, everybody for an all-scope manager); nothing here re-scopes, widens or filters it by reporting lines. A report the caller may not see is a
// 404 (the page says "Report not found" and nothing else). Pure loaders take the client, so they are testable.
import type { ApiClient } from "@/lib/api/client"
import { classifyApiError } from "@/lib/api/problem"
import { apiServer } from "@/lib/api/server"
import { getPeople } from "@/lib/people"
import { addDays } from "@/lib/shifts"
import type { Session } from "@/lib/session"
import type { Person } from "@/lib/types"
import type { TemplateData } from "@opsdesk/domain/shift-report"
import { parseReportFilters } from "@/lib/shift-report"
import { toInboxCounts, toInboxRow, toReport, toTemplateData } from "./adapters"
import { inboxQuery } from "./query"
import type { InboxCounts, InboxRow, ReportFilters, ReportsData, ShiftReport } from "./types"

export { inboxQuery }

type Reader = Pick<ApiClient, "get">
type Team = { id: string; name: string }

/** One page of the inbox (stored reports and virtual rows) for the filters. `nextCursor` is the API's. */
export async function loadInbox(api: Reader, tz: string, f: Partial<ReportFilters>, teams: Team[], o: { cursor?: string; limit?: number } = {}): Promise<{ rows: InboxRow[]; nextCursor: string | null; counts: InboxCounts | null }> {
  const page = await api.get("/v1/shift-reports", { query: inboxQuery(f, teams, o) })
  return { rows: page.items.map((d) => toInboxRow(d, tz)), nextCursor: page.nextCursor, counts: toInboxCounts(page.counts) }
}

/** The report for an id (its uuid). Null when the caller has no such report (404: unknown and out of scope look the same). */
export async function loadReport(api: Reader, tz: string, id: string): Promise<ShiftReport | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
  try {
    return toReport(await api.get("/v1/shift-reports/{id}", { path: { id } }), tz)
  } catch (e) {
    if (classifyApiError(e).kind === "not_found") return null
    throw e
  }
}

/** The templates of the teams in the caller's scope (a department is matched to a team by NAME). */
export async function loadTemplates(api: Reader): Promise<TemplateData> {
  return toTemplateData(await api.get("/v1/shift-reports/template"))
}

/** The shift key of a deep link, `userId:patternId:date` (the `key` of a virtual inbox row). Null when it is not one. */
export function parseShiftKey(key: string): { userId: string; patternId: string; date: string } | null {
  const m = /^(.+):([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/i.exec(key)
  return m ? { userId: m[1]!, patternId: m[2]!, date: m[3]! } : null
}

/** Everything /daily-reports needs around the first page: the page itself, the people and teams it names and the default window. */
export async function loadReportsData(
  api: Reader,
  o: { tz: string; today: string; session: Pick<Session, "role" | "user">; params: Record<string, string | string[] | undefined>; people: Person[] },
): Promise<ReportsData & { filters: ReportFilters }> {
  const [teams, shifts] = await Promise.all([api.get("/v1/teams"), api.get("/v1/shifts").catch(() => null)])
  const refs = teams.map((t) => ({ id: t.id, name: t.name }))
  // unknown team or person values fall back to "all": the URL cannot name something the caller does not see
  const filters = parseReportFilters(o.params, { teams: refs.map((t) => t.name), people: o.people.map((p) => p.id) })
  const page = await loadInbox(api, o.tz, filters, refs)
  const own = o.session.role.home === "staff"
  // a member's prompts and "My shift report" card read the UNFILTERED window, whatever the list below is filtered to
  const filtered = Object.values(filters).some((v) => v && v !== "all")
  const mine = own ? (filtered ? (await loadInbox(api, o.tz, {}, refs)).rows : page.rows) : undefined
  const to = o.today.slice(0, 10)
  return {
    filters,
    rows: page.rows,
    ...(mine ? { mine } : {}),
    nextCursor: page.nextCursor,
    counts: page.counts,
    scope: own ? "own" : o.session.role.reportScope === "team" ? "team" : "all",
    meId: o.session.user.id,
    people: o.people,
    teams: refs,
    range: { from: addDays(to, -6), to },
    dueAfterMinutes: shifts?.reporting.dueAfterMinutes ?? 0,
  }
}

export type ReportScreen = { api: ApiClient; people: Person[] }
export async function reportsScreenData(): Promise<ReportScreen> {
  const [api, people] = await Promise.all([apiServer(), getPeople()])
  return { api, people }
}
