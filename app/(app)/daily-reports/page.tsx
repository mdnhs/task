import { ReportsView, getReportSeed } from "@/features/reports"
import { AccessRestricted } from "@/features/shell"
import { formatDate } from "@/lib/dates"
import { getOrg } from "@/lib/org"
import { parseReportFilters } from "@/lib/shift-report"
import { getSession } from "@/lib/session"

// Shift reports (FR-M1-22..31). The URL stays /daily-reports so old links keep working; the nav label is "Shift Reports".
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, session, org] = await Promise.all([searchParams, getSession(), getOrg()])
  const seed = await getReportSeed(session)
  if (!seed) return <AccessRestricted moduleLabel="Shift Reports" />
  const initialFilters = parseReportFilters(sp, { teams: seed.teams, people: seed.people.map((p) => p.id) })
  return (
    <ReportsView
      key={JSON.stringify(initialFilters)}
      seed={seed}
      now={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      initialFilters={initialFilters}
      exportMeta={{ company: session.tenant.name, generated: `${formatDate(org.today)} · ${org.tzLabel}`, brand: session.tenant.brand }}
    />
  )
}
