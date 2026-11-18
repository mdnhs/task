import { AuditView, actorNames, getAuditEvents } from "@/features/audit"
import { AccessRestricted, apiFailureView } from "@/features/shell"
import { getOrg } from "@/lib/org"
import { can } from "@/lib/permissions"
import { requireMfaOk } from "@/lib/session"

export default async function Page() {
  // This page calls the API (audit:read): it gates itself on the second factor first.
  const session = await requireMfaOk()
  if (!can(session.role, "audit")) return <AccessRestricted moduleLabel="Audit Log" />
  const org = await getOrg()
  let first
  let names
  try {
    names = await actorNames()
    first = await getAuditEvents(org.timezone, names)
  } catch (e) {
    const gate = apiFailureView(e, "Audit Log")
    if (gate) return gate
    throw e
  }
  return <AuditView events={first.events} nextCursor={first.nextCursor} today={org.today} tzLabel={org.tzLabel} timezone={org.timezone} names={names} />
}
