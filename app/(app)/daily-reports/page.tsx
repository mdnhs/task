import { DeadlineCountdown } from "@/features/dashboard"
import { ReportsView, getReportSeed, parseFilters } from "@/features/reports"
import { AccessRestricted } from "@/features/shell"
import { formatDate } from "@/lib/dates"
import { ME_ID } from "@/lib/people"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [sp, session, org] = await Promise.all([searchParams, getSession(), getOrg()])
  if (!can(session.role, "reports")) return <AccessRestricted moduleLabel="Daily Reports" />
  const { template, people, staff, seed, scopeKey } = await getReportSeed(session)
  const initialFilters = parseFilters(sp, [...new Set(seed.map((r) => r.owner))])
  const [hour, minute] = org.deadline.split(":").map(Number)
  return (
    <ReportsView
      key={JSON.stringify(initialFilters)}
      reports={seed}
      template={template}
      people={people}
      departments={org.departments}
      today={org.today}
      tzLabel={org.tzLabel}
      countdown={<DeadlineCountdown hour={hour} minute={minute} timeZone={org.timezone} />}
      deadline={org.deadline}
      reminders={org.reminders}
      staff={staff}
      canReview={!staff && canWrite(session, "reports")}
      meId={ME_ID}
      initialFilters={initialFilters}
      scopeKey={scopeKey}
      exportMeta={{ company: session.tenant.name, generated: `${formatDate(org.today)} · ${org.tzLabel}`, brand: session.tenant.brand }}
      canPayroll={can(session.role, "payroll")}
    />
  )
}
