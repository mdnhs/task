import { ReportPage, loadReport, loadTemplates, makeReportsClient, parseShiftKey, reportsScreenData } from "@/features/reports"
import { templateFor } from "@opsdesk/domain/shift-report"
import { AccessRestricted, apiFailureView } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can, canReview } from "@/lib/permissions"
import { canWrite, requireMfaOk } from "@/lib/session"

// Next 16: `params` is a Promise. The id is the report's uuid; a shift key (`userId:patternId:date`, from a deep link to a shift with no report yet) is opened for its OWN member through
// POST /v1/shift-reports/open by the page's client part. An unknown id, another person's, or one out of the caller's scope is a 404 from the API and shows "Report not found" with no detail (F5).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, requireMfaOk()])
  if (!can(session.role, "reports")) return <AccessRestricted moduleLabel="Shift Reports" />
  let rid = id
  try {
    rid = decodeURIComponent(id)
  } catch {
    // malformed escape: look the raw value up, it simply will not be found
  }
  const loaded = await Promise.all([reportsScreenData(), getOrg()])
    .then(async ([{ api, people }, org]) => {
      const key = parseShiftKey(rid)
      const report = key ? null : await loadReport(api, org.timezone, rid)
      const [versions, templates] = report
        ? await Promise.all([makeReportsClient(api, org.timezone).versions(report), loadTemplates(api).catch(() => ({ departments: [] }))])
        : [[], { departments: [] }]
      return { ok: true as const, people, org, key, report, versions, templates }
    })
    .catch((e: unknown) => ({ ok: false as const, e }))
  if (!loaded.ok) {
    const v = apiFailureView(loaded.e, "Shift Reports")
    if (v) return v
    throw loaded.e
  }
  const { people, org, key, report, versions, templates } = loaded
  const meId = session.user.id
  // a key opens only for its own member (the API refuses anything else with 404 as well)
  const openKey = key && key.userId === meId ? { patternId: key.patternId, date: key.date } : null
  const owner = report ? (people.find((p) => p.id === report.personId)?.name ?? (report.personId === meId ? session.user.name : "Former member")) : ""
  return (
    <ReportPage
      report={report}
      openKey={openKey}
      versions={versions}
      template={report ? templateFor(report.team, templates) : []}
      owner={owner}
      meId={meId}
      now={org.today}
      nowAt={org.nowAt ?? ""}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      canWrite={canWrite(session, "reports")}
      canReview={canReview(session.role, session.tenant.status)}
      canOpenTasks={can(session.role, "tasks")}
    />
  )
}
