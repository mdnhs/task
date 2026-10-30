import { ReportPage, getReportSeed } from "@/features/reports"
import { AccessRestricted, getUser } from "@/features/shell"
import { formatDate } from "@/lib/dates"
import { getOrg } from "@/lib/org"
import { canReview } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"

// Next 16: `params` is a Promise. Seeded exactly like /daily-reports (same seed + scopeKey) so drafts persist across pages.
// Unknown or out-of-scope ids render "Report not found" from the client lookup (other people's reports are never sent).
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, org, user] = await Promise.all([params, getSession(), getOrg(), getUser()])
  const seed = await getReportSeed(session)
  if (!seed) return <AccessRestricted moduleLabel="Shift Reports" />
  let rid = id
  try {
    rid = decodeURIComponent(id)
  } catch {
    // malformed escape: look the raw value up, it simply will not be found
  }
  const me = seed.people.find((p) => p.id === seed.meId)?.name || user.name
  return (
    <ReportPage
      id={rid}
      seed={seed}
      now={org.today}
      tz={org.timezone}
      tzLabel={org.tzLabel}
      canWrite={canWrite(session, "reports")}
      canReview={canReview(session.role, session.tenant.status)}
      me={me}
      tenantId={session.tenant.id}
      exportMeta={{ company: session.tenant.name, generated: `${formatDate(org.today)} · ${org.tzLabel}`, brand: session.tenant.brand }}
    />
  )
}
