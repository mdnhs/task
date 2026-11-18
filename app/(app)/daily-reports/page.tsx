import { ReportsView, loadReportsData, reportsScreenData } from "@/features/reports"
import { AccessRestricted, apiFailureView } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { requireMfaOk } from "@/lib/session"

// Shift reports (FR-M1-22..31) on the API (B6 T6.7). The URL stays /daily-reports so old links keep working; the nav label is "Shift Reports". The inbox is the API's: filters in the URL are
// answered by the server, paging is its cursor, and the scope is the API's (own, direct reports, or everyone): nothing is widened here (F5).
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireMfaOk()
  if (!can(session.role, "reports")) return <AccessRestricted moduleLabel="Shift Reports" />
  const sp = await searchParams
  // a refusal (403, module not in the plan) is a full-page state; anything else goes to the error boundary
  const loaded = await Promise.all([reportsScreenData(), getOrg()])
    .then(async ([{ api, people }, org]) => ({ ok: true as const, org, data: await loadReportsData(api, { tz: org.timezone, today: org.today, session, params: sp, people }) }))
    .catch((e: unknown) => ({ ok: false as const, e }))
  if (!loaded.ok) {
    const v = apiFailureView(loaded.e, "Shift Reports")
    if (v) return v
    throw loaded.e
  }
  const { org, data } = loaded
  return <ReportsView key={JSON.stringify(data.filters)} data={data} now={org.today} nowAt={org.nowAt ?? ""} tz={org.timezone} tzLabel={org.tzLabel} initialFilters={data.filters} />
}
