import { getOrg } from "@/lib/org"
import { ME_ID, getPeople } from "@/lib/people"
import { reportScope } from "@/lib/permissions"
import type { Session } from "@/lib/session"
import { scopeReports, templateFor, type TemplateSection } from "@/lib/shift-report"
import { getShiftReportData } from "@/lib/shift-reports-data"
import type { ReportsSeed } from "./types"

/**
 * Server only. The one place that decides what the reports store is seeded with (/daily-reports and /daily-reports/[id]
 * share it, so the same seed + scopeKey keeps in-session edits). Staff get only their own reports and their own tasks;
 * a team-scoped manager only their team's. Nothing else reaches the client.
 */
export async function getReportSeed(session: Session): Promise<ReportsSeed | null> {
  const scope = reportScope(session.role, ME_ID)
  if (!scope) return null
  const org = await getOrg()
  const [{ rows, template, shifts, range }, people] = await Promise.all([getShiftReportData(org), getPeople()])
  const reports = scopeReports(rows, scope, shifts.members)
  const meId = scope.kind === "own" ? scope.personId : session.role.person ?? ""
  const ids = new Set([...reports.map((r) => r.personId), meId])
  const teams = org.departments.filter((t) => reports.some((r) => r.team === t))
  const templates: Record<string, TemplateSection[]> = Object.fromEntries(teams.map((t) => [t, templateFor(t, template)]))
  return {
    reports,
    templates,
    people: people.filter((p) => ids.has(p.id)),
    teams,
    scope: scope.kind,
    meId,
    scopeKey: `${session.tenant.id}:${session.role.id}`,
    range,
    dueAfterMinutes: shifts.reporting.dueAfterMinutes,
  }
}
