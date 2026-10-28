import { ReportForm, getReportSeed } from "@/features/reports"
import { AccessRestricted, getUser } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { ME_ID } from "@/lib/people"
import { can, canReview } from "@/lib/permissions"
import { canWrite, getSession } from "@/lib/session"
import { formatDate } from "@/lib/dates"
import { loadPrefill } from "../prefill"

// Next 16: `params` is a Promise. Seeded exactly like /daily-reports (same seed + scopeKey) so drafts persist across pages.
// Unknown or out-of-scope ids render "Report not found" from the client lookup.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session, org, user] = await Promise.all([params, getSession(), getOrg(), getUser()])
  if (!can(session.role, "reports")) return <AccessRestricted moduleLabel="Daily Reports" />
  const { template, people, staff, seed, scopeKey } = await getReportSeed(session)
  let rid = id
  try {
    rid = decodeURIComponent(id)
  } catch {
    // malformed escape: look the raw value up, it simply will not be found
  }
  const prefill = staff && canWrite(session, "reports") ? await loadPrefill(session, org, seed.find((r) => r.id === rid), ME_ID) : undefined
  const me = (staff && people.find((p) => p.id === ME_ID)?.name) || user.name
  return (
    <ReportForm
      id={rid}
      seed={seed}
      scopeKey={scopeKey}
      template={template}
      people={people}
      org={org}
      canEdit={canWrite(session, "reports")}
      canReview={canReview(session.role, session.tenant.status)}
      meId={staff ? ME_ID : ""}
      canPayroll={can(session.role, "payroll")}
      me={me}
      exportMeta={{ company: session.tenant.name, generated: `${formatDate(org.today)} · ${org.tzLabel}`, brand: session.tenant.brand }}
      prefill={prefill}
    />
  )
}
